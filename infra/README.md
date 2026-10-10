# Infra (AWS CDK, Python)

`PanoptiCoalStack` (ap-south-1): private encrypted S3 bucket with `pipeline/data/export/*.json`
(BucketDeployment, under `data/`), the API Lambda from `api/` (Python 3.12, arm64, 256 MB, 10 s),
an HTTP API (CORS: localhost + `-c allowed_origins=...`; throttling 10 rps / burst 20, briefs
1 rps / burst 2) and least-privilege IAM (s3:GetObject on `data/*`, bedrock:InvokeModel on the one
model). Outputs: `ApiUrl`, `BucketName`.

```
cd infra
python -m venv .venv && source .venv/Scripts/activate   # Windows Git Bash; py -3.12 for the venv
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest -q                                     # template assertions
cdk synth --profile emissionwatch
```
Deploy steps: see `../DEPLOY.md`.
