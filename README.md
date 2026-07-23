# Code2Cloud

A fancy-but-simple web app that runs on containers, deploys to Kubernetes, and is
publicly exposed behind an NGINX Ingress. Images are built by Jenkins and pushed
to Docker Hub `ripclawbr/code2cloud`.

## Architecture

```
User --> Cloud Load Balancer --> NGINX Ingress Controller
                                     |-- /      --> frontend (Service) --> Nginx + React SPA
                                     |-- /api   --> backend  (Service) --> FastAPI (uvicorn)
```

- **Backend**: Python + FastAPI (`/api/health`, `/api/hello`)
- **Frontend**: React + Vite, built to static assets, served by Nginx (non-root)
- **Routing**: Single Ingress; `/api` -> backend (prefix preserved, no rewrite), `/` -> frontend
- **Registry**: Both images share `ripclawbr/code2cloud`, distinguished by tag
  (`backend-<build>` / `frontend-<build>` plus `*-latest`)

## Project layout

```
.
├── backend/            # FastAPI service
│   ├── app/main.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/           # React + Vite SPA
│   ├── src/
│   ├── nginx.conf
│   └── Dockerfile
├── k8s/                # Kubernetes manifests
│   ├── namespace.yaml
│   ├── backend-deployment.yaml
│   ├── backend-service.yaml
│   ├── frontend-deployment.yaml
│   ├── frontend-service.yaml
│   └── ingress.yaml
├── Jenkinsfile
└── README.md
```

## Local development

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# Test: curl http://localhost:8000/api/hello
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# Opens http://localhost:5173 ; /api calls are proxied to :8000
```

## Build images locally

```bash
docker build -t ripclawbr/code2cloud:backend-latest ./backend
docker build -t ripclawbr/code2cloud:frontend-latest ./frontend
```

## Deploy to Kubernetes

### Prerequisites

Install the NGINX Ingress Controller if the cluster does not have one:

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/cloud/deploy.yaml
```

### Apply manifests

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/
```

### Access the app

The Ingress uses host `code2cloud.local`. Point that host at the Ingress
Controller's external IP:

```bash
# Get the LoadBalancer IP of the ingress controller
kubectl get svc -n ingress-nginx ingress-nginx-controller

# Add to /etc/hosts (replace EXTERNAL_IP)
echo "EXTERNAL_IP code2cloud.local" | sudo tee -a /etc/hosts
```

Then open `http://code2cloud.local`.

For local clusters (minikube/kind), you can instead run
`minikube tunnel` or `kubectl port-forward` against the ingress controller.

## CI/CD (Jenkins)

The `Jenkinsfile` defines a declarative pipeline:

1. **Checkout** the repository
2. **Build Images** — backend and frontend built in parallel
3. **Push Images** — logs in with the `dockerhub-creds` credential and pushes
   `backend-<build>`, `frontend-<build>`, and the `*-latest` tags to
   `ripclawbr/code2cloud`
4. **Deploy to Kubernetes** (only on `main`) — applies manifests and rolls out
   the new image tags via `kubectl set image`

### Jenkins setup requirements

- A Docker-capable agent (Docker CLI + daemon access)
- A **Username with password** credential in Jenkins with id `dockerhub-creds`
  containing the Docker Hub username and an access token/password
- For the deploy stage: a kubeconfig available to the agent (e.g. the Kubernetes
  CLI plugin `withKubeConfig`, or a mounted `KUBECONFIG`) and `kubectl` installed

## End-to-end flow

```
git push (main)
   -> Jenkins pipeline
        -> docker build backend + frontend
        -> docker push ripclawbr/code2cloud:{backend,frontend}-<build>
        -> kubectl apply + set image
             -> Kubernetes rolls out new pods
                  -> NGINX Ingress serves traffic publicly
```
