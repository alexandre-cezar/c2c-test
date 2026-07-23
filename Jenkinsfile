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
