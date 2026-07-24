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
    // Cortex XDR tenant API base URL (required by the cortexcli image scan)
    CORTEX_API_BASE_URL = 'https://api-pmemdemo.xdr.us.paloaltonetworks.com'
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

    // Gate: runs on the locally built images, before anything is pushed or
    // deployed, so a failing scan stops a vulnerable image from shipping.
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

            crtx_body=$(mktemp)
            trap 'rm -f "$crtx_body"' EXIT

            # Capture the status separately: this endpoint returns an empty body
            # on auth failure, so the status code is the only useful signal.
            crtx_http=$(curl -s -o "$crtx_body" -w '%{http_code}' \
              "https://api-pmemdemo.xdr.us.paloaltonetworks.com/public_api/v1/unified-cli/releases/download-link?os=linux&architecture=amd64" \
              -H "x-xdr-auth-id: ${CORTEX_API_KEY_ID}" \
              -H "Authorization: ${CORTEX_API_KEY}")

            crtx_resp=$(cat "$crtx_body")
            crtx_url=$(echo "$crtx_resp" | jq -r ".signed_url // empty" 2>/dev/null)
            crtx_file=$(echo "$crtx_resp" | jq -r ".file_name // empty" 2>/dev/null)

            if [ -z "$crtx_url" ]; then
              echo "Failed to obtain Cortex CLI download link (HTTP ${crtx_http})."
              if [ "$crtx_http" = "401" ] || [ "$crtx_http" = "403" ]; then
                echo "Auth rejected. Check the 'cortex-api-key-id' credential: it is the"
                echo "small integer key ID from the Cortex console, not the 128-char API key."
              fi
              echo "Response body: ${crtx_resp:-<empty>}"
              exit 1
            fi

            curl -sSf -o "$crtx_file" "$crtx_url"
            chmod +x "$crtx_file"

            # cortexcli authenticates from CORTEX_API_KEY_ID / CORTEX_API_KEY (set
            # by withCredentials above) plus CORTEX_API_BASE_URL (pipeline env).
            # The image reference is a POSITIONAL argument; --name is only a label.
            # NOTE: cortexcli exits 0 even when it finds vulnerabilities, so this
            # stage reports but does not block on its own. Enforcement is done by
            # policy on the Cortex platform. To make it a hard gate here, add a
            # threshold check on --output-format json (see the PR discussion).
            ./"$crtx_file" image scan "${IMAGE_REPO}:${BACKEND_TAG}"  --timeout 600
            ./"$crtx_file" image scan "${IMAGE_REPO}:${FRONTEND_TAG}" --timeout 600
          '''
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
        // 'kubeconfig-c2c' is a Secret file credential holding the kubeconfig for
        // the jenkins-deployer ServiceAccount (namespace-scoped context). The file
        // binding points KUBECONFIG at a temp copy that Jenkins wipes after the block.
        withCredentials([file(credentialsId: 'kubeconfig-c2c', variable: 'KUBECONFIG')]) {
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
