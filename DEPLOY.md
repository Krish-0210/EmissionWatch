# Deploy (AWS, ap-south-1)

Everything uses the `emissionwatch` profile. Run from Git Bash in the repo root unless noted.
Nothing has been deployed yet; `cdk synth` and all tests pass.

## 0. Prerequisites (once)
```bash
aws sts get-caller-identity --profile emissionwatch          # note the account id
cdk --version                                                # 2.1145.0 installed globally
```
Bedrock: in the console (ap-south-1) open **Bedrock → Model access** and make sure
**Anthropic Claude Haiku 4.5** is enabled (Anthropic models need the one-time use-case form).
Check the inference profile exists:
```bash
aws bedrock list-inference-profiles --region ap-south-1 --profile emissionwatch \
  --query "inferenceProfileSummaries[?inferenceProfileId=='in.anthropic.claude-haiku-4-5-20251001-v1:0'].status"
```
If briefs fail for any reason the API still answers with the template brief (`"source": "template"`).

## 1. Fresh data export (optional)
```bash
cd pipeline && .venv/Scripts/python.exe -m src.export.to_json && cd ..
```
The stack uploads `pipeline/data/export/*.json`; synth fails if `clusters.json` is missing.

## 2. Bootstrap and deploy
```bash
cd infra
source .venv/Scripts/activate
ACCOUNT=$(aws sts get-caller-identity --profile emissionwatch --query Account --output text)
cdk bootstrap aws://$ACCOUNT/ap-south-1 --profile emissionwatch
cdk deploy EmissionWatchStack --profile emissionwatch
```
Outputs: `ApiUrl` (e.g. `https://abc123.execute-api.ap-south-1.amazonaws.com`) and `BucketName`.
Put them in `.env`: `S3_BUCKET_NAME=<BucketName>`, `BEDROCK_MODEL_ID=in.anthropic.claude-haiku-4-5-20251001-v1:0`.

## 3. Smoke test
```bash
API=<ApiUrl>
curl -s $API/clusters | head -c 300; echo
curl -s $API/clusters/talcher | head -c 200; echo
curl -s $API/clusters/talcher/timeseries | head -c 200; echo
curl -s $API/summary | head -c 200; echo
curl -s -o /dev/null -w "%{http_code}\n" $API/clusters/atlantis        # 404
curl -s -X POST $API/brief/talcher | head -c 400; echo                 # "source": "bedrock" (or "template")
```
Logs: `aws logs tail /aws/lambda/<function name> --follow --profile emissionwatch --region ap-south-1`
(the function name is in the CloudFormation console; a "Bedrock failed" warning explains any template fallback).

## 4. Frontend against the API (local)
```bash
cd frontend
echo "VITE_API_URL=<ApiUrl>" > .env.local                    # gitignored (.env.*)
npm run dev                                                  # http://localhost:5173, allowed by CORS
```

## 5. Amplify Hosting
1. Push `main` to GitHub.
2. Console → **AWS Amplify → Create new app → GitHub** → repo `Krish-0210/EmissionWatch`, branch `main`.
   Tick **"My app is a monorepo"**, app root `frontend`.
3. Build settings (replace the generated `amplify.yml` with this):
   ```yaml
   version: 1
   applications:
     - appRoot: frontend
       frontend:
         phases:
           preBuild:
             commands:
               - nvm install 22 && nvm use 22
               - npm ci
           build:
             commands:
               - npm run build
         artifacts:
           baseDirectory: dist
           files:
             - '**/*'
         cache:
           paths:
             - node_modules/**/*
   ```
4. **Environment variables**: `VITE_API_URL = <ApiUrl>` (no trailing slash).
5. **Rewrites and redirects** (needed for BrowserRouter deep links such as `/cluster/talcher`):
   source `</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>`,
   target `/index.html`, type `200 (Rewrite)`.
6. Save and deploy. Note the domain, e.g. `https://main.d1234abcd.amplifyapp.com`.

## 6. Allow the Amplify domain in CORS
```bash
cd infra && source .venv/Scripts/activate
cdk deploy EmissionWatchStack --profile emissionwatch -c allowed_origins=https://main.d1234abcd.amplifyapp.com
```
(Comma-separate several origins. Add it to `cdk.json` → `context.allowed_origins` to make it stick.)

## Limits and cost guards
- HTTP API throttling: 10 rps, burst 20; `POST /brief/{id}` 1 rps, burst 2.
- Lambda: 256 MB, 10 s timeout; Bedrock call times out after 7 s and falls back to the template.
- Bucket is private (block public access, SSE-S3, TLS only); only the Lambda reads `data/*`.

## Teardown
```bash
cd infra && cdk destroy EmissionWatchStack --profile emissionwatch   # bucket is emptied and deleted
```
