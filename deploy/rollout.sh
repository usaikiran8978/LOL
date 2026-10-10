#!/usr/bin/env bash
# Usage: deploy/rollout.sh <staging|production> <registry> <tag>
# Runs the migration job to completion, then rolls the API to the new image and waits for health.
# (The admin console is deployed from its own repository, LOL-Admin-Web.)
set -euo pipefail
ENV="$1"; REGISTRY="$2"; TAG="$3"
NS="amora-${ENV}"
: "${KUBE_CONFIG:?KUBE_CONFIG secret is required}"
export KUBECONFIG="$(mktemp)"; trap 'rm -f "$KUBECONFIG"' EXIT
echo "$KUBE_CONFIG" | base64 -d > "$KUBECONFIG"
cd "$(dirname "$0")/k8s/overlays/${ENV}"

JOB="amora-migrate-${TAG:0:12}"
sed -e "s|name: amora-migrate$|name: ${JOB}|" -e "s|ghcr.io/OWNER/amora-migrate:latest|${REGISTRY}/amora-migrate:${TAG}|" ../../base/migrate-job.yaml \
  | kubectl -n "$NS" apply -f -
kubectl -n "$NS" wait --for=condition=complete "job/${JOB}" --timeout=600s || {
  kubectl -n "$NS" logs "job/${JOB}" --tail=200 || true
  echo "Migration failed — rollout aborted (running pods keep serving the previous version)." >&2
  exit 1
}

kustomize edit set image "ghcr.io/OWNER/amora-api=${REGISTRY}/amora-api:${TAG}"
kubectl -n "$NS" apply -k .
kubectl -n "$NS" rollout status deploy/amora-api --timeout=600s || { kubectl -n "$NS" rollout undo deploy/amora-api; exit 1; }
echo "Deployed ${TAG} to ${ENV}"
