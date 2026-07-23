pipeline {
  agent any

  environment {
    REGISTRY       = 'docker.io'
    IMAGE_REPO     = 'ripclawbr/code2cloud'
    // Jenkins credentials (Username with password) id for Docker Hub
    DOCKERHUB_CREDS = 'dockerhub-creds'
    // Distinct tags in the single shared repo
    BACKEND_TAG    = "backend-${env.BUILD_NUMBER}"
    FRONTEND_TAG   = "frontend-${env.BUILD_NUMBER}"
    K8S_NAMESPACE  = 'code2cloud'
  }

  options {
    timestamps()
    disableConcurrentBuilds()
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Build Images') {
      parallel {
        stage('Build Backend') {
          steps {
            sh '''
              docker build \
                -t ${IMAGE_REPO}:${BACKEND_TAG} \
                -t ${IMAGE_REPO}:backend-latest \
                ./backend
            '''
          }
        }
        stage('Build Frontend') {
          steps {
            sh '''
              docker build \
                -t ${IMAGE_REPO}:${FRONTEND_TAG} \
                -t ${IMAGE_REPO}:frontend-latest \
                ./frontend
            '''
          }
        }
      }
    }

    stage('Push Images') {
      steps {
        withCredentials([usernamePassword(
          credentialsId: "${DOCKERHUB_CREDS}",
          usernameVariable: 'DOCKER_USER',
          passwordVariable: 'DOCKER_PASS'
        )]) {
          sh '''
            echo "${DOCKER_PASS}" | docker login ${REGISTRY} -u "${DOCKER_USER}" --password-stdin
            docker push ${IMAGE_REPO}:${BACKEND_TAG}
            docker push ${IMAGE_REPO}:backend-latest
            docker push ${IMAGE_REPO}:${FRONTEND_TAG}
            docker push ${IMAGE_REPO}:frontend-latest
            docker logout ${REGISTRY}
          '''
        }
      }
    }

    stage('Deploy to Kubernetes') {
      when {
        branch 'main'
      }
      steps {
        // Requires a kubeconfig available to the agent (e.g. via withKubeConfig
        // from the Kubernetes CLI plugin, or a mounted KUBECONFIG).
        sh '''
          kubectl apply -f k8s/namespace.yaml
          kubectl apply -f k8s/
          kubectl -n ${K8S_NAMESPACE} set image deployment/backend backend=${IMAGE_REPO}:${BACKEND_TAG}
          kubectl -n ${K8S_NAMESPACE} set image deployment/frontend frontend=${IMAGE_REPO}:${FRONTEND_TAG}
          kubectl -n ${K8S_NAMESPACE} rollout status deployment/backend --timeout=120s
          kubectl -n ${K8S_NAMESPACE} rollout status deployment/frontend --timeout=120s
        '''
      }
    }

    stage('Vulnerability Scan') {
      steps {
        // Secret text credentials, created in Jenkins as:
        //   cortex-api-key-id -> x-xdr-auth-id  (integer from the Cortex console)
        //   cortex-api-key    -> Authorization  (128-char API key)
        withCredentials([
          string(credentialsId: 'cortex-api-key-id', variable: 'CORTEX_API_KEY_ID'),
          string(credentialsId: 'cortex-api-key',    variable: 'CORTEX_API_KEY')
        ]) {
          // NOTE: single-quoted sh block on purpose. Using double quotes would make
          // Groovy interpolate the secrets into the script text, which leaks them
          // into the build log and defeats Jenkins' credential masking.
          sh '''
            set -eu

            crtx_resp=$(curl -s "https://api-pmemdemo.xdr.us.paloaltonetworks.com/public_api/v1/unified-cli/releases/download-link?os=linux&architecture=amd64" \
              -H "x-xdr-auth-id: ${CORTEX_API_KEY_ID}" \
              -H "Authorization: ${CORTEX_API_KEY}")

            crtx_url=$(echo "$crtx_resp" | jq -r ".signed_url")
            crtx_file=$(echo "$crtx_resp" | jq -r ".file_name")

            if [ -z "$crtx_url" ] || [ "$crtx_url" = "null" ]; then
              echo "Failed to obtain Cortex CLI download link. API response:"
              echo "$crtx_resp"
              exit 1
            fi

            curl -sSf -o "$crtx_file" "$crtx_url"
            chmod +x "$crtx_file"

            ./"$crtx_file" image scan --name "${IMAGE_REPO}:${BACKEND_TAG}"
            ./"$crtx_file" image scan --name "${IMAGE_REPO}:${FRONTEND_TAG}"
          '''
        }
      }
    }
  }

  post {
    always {
      sh 'docker image prune -f || true'
    }
    success {
      echo "Build ${env.BUILD_NUMBER} pushed: ${IMAGE_REPO}:${BACKEND_TAG}, ${IMAGE_REPO}:${FRONTEND_TAG}"
    }
    failure {
      echo "Build ${env.BUILD_NUMBER} failed."
    }
  }
}
