# Code2Cloud

A fancy-but-simple web app that runs on containers, deploys to Kubernetes, and is
publicly exposed behind an NGINX Ingress. Images are built by Jenkins and pushed
to Docker Hub `ripclawbr/code2cloud`.

This README explains **how the app works** and walks through an **end-to-end (E2E)
deployment** — from source code to a publicly reachable URL.

---

## Table of contents

1. [How it works](#how-it-works)
2. [Request flow](#request-flow)
3. [Project layout](#project-layout)
4. [Component deep dive](#component-deep-dive)
5. [Local development](#local-development)
6. [Build images](#build-images)
7. [End-to-end deployment](#end-to-end-deployment)
8. [Verify the deployment](#verify-the-deployment)
9. [CI/CD with Jenkins](#cicd-with-jenkins)
10. [Troubleshooting](#troubleshooting)
11. [Cleanup](#cleanup)

---

## How it works

Code2Cloud is split into two independently deployable services:

- **Backend** — a Python **FastAPI** app served by `uvicorn`. It exposes a small
  JSON API under `/api` (`/api/health` for probes, `/api/hello` for demo data
  including the pod hostname so you can see load balancing in action).
- **Frontend** — a **React + Vite** single-page app compiled to static assets and
  served by **Nginx** (running as a non-root user). The UI fetches `/api/hello`
  and renders which pod answered.

Both are packaged as container images and run as **Deployments** in Kubernetes.
Each Deployment sits behind a **ClusterIP Service** (internal-only). A single
**NGINX Ingress** is the one public entry point: the cloud provider gives the
Ingress Controller a **LoadBalancer** with an external IP, and the Ingress routes:

- `/api` → **backend** Service (the `/api` prefix is preserved, so FastAPI routes
  match directly — no URL rewriting)
- `/` → **frontend** Service (everything else, including SPA client-side routes)

Because the frontend calls the API through the same Ingress host (`/api`), the
browser makes **same-origin** requests in production — no CORS gymnastics needed.

### Why this design

| Goal | How it's met |
|------|--------------|
| Runs on containers | Multi-stage Dockerfiles for both services |
| Deployed on Kubernetes | Deployments + Services + Ingress manifests in `k8s/` |
| Separated frontend/backend | Two images, two Deployments, two Services |
| Publicly exposed behind a load balancer | NGINX Ingress Controller fronted by a cloud LB |
| Built on Jenkins → Docker Hub | `Jenkinsfile` builds and pushes to `ripclawbr/code2cloud` |

---

## Request flow

```
                         Internet
                            |
                            v
              +---------------------------+
              |   Cloud Load Balancer     |   (external IP, provisioned by
              |   (Service type LB)       |    the Ingress Controller)
              +---------------------------+
                            |
                            v
              +---------------------------+
              | NGINX Ingress Controller  |   host: code2cloud.local
              +---------------------------+
                     |               |
        path: /      |               |  path: /api
                     v               v
        +---------------+     +---------------+
        | frontend Svc  |     | backend Svc   |   (ClusterIP, internal)
        |   :80 -> 8080 |     |   :80 -> 8000 |
        +---------------+     +---------------+
                |                     |
                v                     v
        +---------------+     +---------------+
        | frontend Pods |     | backend Pods  |
        | Nginx + React |     | FastAPI/uvicorn|
        | (2 replicas)  |     | (2 replicas)  |
        +---------------+     +---------------+
```

---

## Project layout

```
.
├── backend/                    # FastAPI service
│   ├── app/main.py             # API routes (/api/health, /api/hello)
│   ├── requirements.txt        # Python dependencies
│   ├── Dockerfile              # multi-stage, non-root, uvicorn on :8000
│   └── .dockerignore
├── frontend/                   # React + Vite SPA
│   ├── src/
│   │   ├── main.jsx            # React entrypoint
│   │   ├── App.jsx             # UI that calls /api/hello
│   │   └── styles.css          # styling
│   ├── index.html
│   ├── vite.config.js          # dev proxy /api -> :8000
│   ├── nginx.conf              # static serve + SPA fallback + /healthz
│   ├── Dockerfile              # build then serve via nginx-unprivileged :8080
│   └── package.json
├── k8s/                        # Kubernetes manifests
│   ├── namespace.yaml          # code2cloud namespace
│   ├── backend-deployment.yaml # 2 replicas, probes, resource limits
│   ├── backend-service.yaml    # ClusterIP :80 -> :8000
│   ├── frontend-deployment.yaml# 2 replicas, probes, resource limits
│   ├── frontend-service.yaml   # ClusterIP :80 -> :8080
│   └── ingress.yaml            # / -> frontend, /api -> backend
├── Jenkinsfile                 # build + push + deploy pipeline
└── README.md
```

---

## Component deep dive

### Backend (FastAPI)

- `GET /api/health` — returns `{"status": "ok"}`; used by liveness/readiness probes.
- `GET /api/hello` — returns a greeting plus `hostname`, `python_version`,
  `environment`, and `timestamp`. Refreshing in the UI shows different pod
  hostnames as the load balancer spreads requests.
- Runs as a **non-root** user with a **read-only root filesystem** and **all Linux
  capabilities dropped** in Kubernetes.

### Frontend (React + Nginx)

- Vite compiles the SPA to static assets served by `nginx-unprivileged` on
  **port 8080**.
- `nginx.conf` provides an **SPA fallback** (`try_files ... /index.html`), gzip,
  aggressive caching for hashed assets, and a `/healthz` endpoint for probes.
- In local dev, `vite.config.js` proxies `/api` to `http://localhost:8000` so the
  same relative API paths work in both dev and production.

### Kubernetes

- Both Deployments run **2 replicas** with **liveness/readiness probes** and
  **resource requests/limits**.
- Services are **ClusterIP** — only the Ingress is exposed publicly.
- The Ingress routes by path with **no rewrite**, so the backend keeps the `/api`
  prefix.

---

## Local development

Run the two services in separate terminals.

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# Test:
curl http://localhost:8000/api/hello
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# Open http://localhost:5173  (Vite proxies /api to the backend on :8000)
```

---

## Build images

Both services share one Docker Hub repo, distinguished by tag prefix:

```bash
docker build -t ripclawbr/code2cloud:backend-latest ./backend
docker build -t ripclawbr/code2cloud:frontend-latest ./frontend

# Optionally push manually (CI does this automatically):
docker login
docker push ripclawbr/code2cloud:backend-latest
docker push ripclawbr/code2cloud:frontend-latest
```

---

## End-to-end deployment

This is the full path from code to a public URL. You can do it **manually**
(steps below) or let **Jenkins** do it (see [CI/CD](#cicd-with-jenkins)).

### Prerequisites

- A Kubernetes cluster and `kubectl` configured to reach it
  (`kubectl cluster-info` works).
- The **NGINX Ingress Controller** installed. If not already present:

  ```bash
  kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/cloud/deploy.yaml
  kubectl wait --namespace ingress-nginx \
    --for=condition=ready pod \
    --selector=app.kubernetes.io/component=controller \
    --timeout=120s
  ```

- Images available in `ripclawbr/code2cloud` (built and pushed as above).

### Step 1 — Create the namespace

```bash
kubectl apply -f k8s/namespace.yaml
```

### Step 2 — Deploy backend and frontend

```bash
kubectl apply -f k8s/
```

This creates the Deployments, Services, and the Ingress in the `code2cloud`
namespace.

### Step 3 — Pin the image tags (optional)

The manifests reference the `*-latest` tags. To deploy a specific build:

```bash
kubectl -n code2cloud set image deployment/backend  backend=ripclawbr/code2cloud:backend-123
kubectl -n code2cloud set image deployment/frontend frontend=ripclawbr/code2cloud:frontend-123
```

### Step 4 — Wait for rollout

```bash
kubectl -n code2cloud rollout status deployment/backend  --timeout=120s
kubectl -n code2cloud rollout status deployment/frontend --timeout=120s
```

### Step 5 — Point your host at the load balancer

The Ingress uses host `code2cloud.local`. Get the external IP and map it:

```bash
# External IP of the ingress controller's LoadBalancer
kubectl get svc -n ingress-nginx ingress-nginx-controller

# Map the host (replace EXTERNAL_IP)
echo "EXTERNAL_IP code2cloud.local" | sudo tee -a /etc/hosts
```

For **local clusters**:
- **minikube**: run `minikube tunnel` in a separate terminal, then use the
  reported IP.
- **kind / Docker Desktop**: `kubectl -n ingress-nginx port-forward svc/ingress-nginx-controller 8080:80`
  and browse via `http://code2cloud.local:8080` (add `code2cloud.local` to
  `/etc/hosts` pointing at `127.0.0.1`).

Then open **http://code2cloud.local**.

---

## Verify the deployment

```bash
# Everything running?
kubectl -n code2cloud get pods,svc,ingress

# Frontend loads (HTML)
curl -H "Host: code2cloud.local" http://EXTERNAL_IP/

# API responds (JSON, shows the pod that served it)
curl -H "Host: code2cloud.local" http://EXTERNAL_IP/api/hello
```

Refresh the page or re-run the `/api/hello` curl a few times — the `hostname`
field should change between backend pods, confirming load balancing.

---

## CI/CD with Jenkins

The `Jenkinsfile` defines a declarative pipeline that automates the E2E flow:

1. **Checkout** — pulls the repository.
2. **Build Images** — backend and frontend built in **parallel**.
3. **Push Images** — logs in with the `dockerhub-creds` credential and pushes
   `backend-<build>`, `frontend-<build>`, and the `*-latest` tags to
   `ripclawbr/code2cloud`.
4. **Deploy to Kubernetes** (only on `main`) — applies the manifests and rolls
   out the new tags via `kubectl set image`, then waits for rollout.

### Jenkins setup requirements

- A **Docker-capable agent** (Docker CLI + daemon access).
- A **Username with password** credential with id **`dockerhub-creds`** holding
  the Docker Hub username and an access token/password.
- For the deploy stage: a **kubeconfig** available to the agent (e.g. the
  Kubernetes CLI plugin's `withKubeConfig`, or a mounted `KUBECONFIG`) and
  `kubectl` installed on the agent.

### End-to-end flow (automated)

```
git push (main)
   -> Jenkins pipeline
        -> docker build backend + frontend
        -> docker push ripclawbr/code2cloud:{backend,frontend}-<build>
        -> kubectl apply + set image
             -> Kubernetes rolls out new pods
                  -> NGINX Ingress serves traffic publicly
```

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Ingress has no address | Ingress Controller not installed or LB not provisioned. Check `kubectl get svc -n ingress-nginx`. |
| 404 from the Ingress | Host header doesn't match `code2cloud.local`, or path routing misconfigured. Verify `/etc/hosts` and `k8s/ingress.yaml`. |
| Frontend loads but API 502/503 | Backend pods not ready. Check `kubectl -n code2cloud get pods` and `kubectl -n code2cloud logs deploy/backend`. |
| `ImagePullBackOff` | Image tag doesn't exist in `ripclawbr/code2cloud` or registry auth missing. |
| Pods `CrashLoopBackOff` | Inspect logs: `kubectl -n code2cloud logs <pod>`; check probe paths/ports. |
| CORS errors in dev | Ensure you use the Vite dev server (`npm run dev`) so `/api` is proxied. |

---

## Cleanup

```bash
kubectl delete -f k8s/            # remove app resources
kubectl delete -f k8s/namespace.yaml
# Optionally remove the ingress controller if you installed it for this app
```
