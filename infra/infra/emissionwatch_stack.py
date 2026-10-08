"""EmissionWatchStack: private S3 data bucket, API Lambda, HTTP API with CORS + throttling.

Context (cdk.json or -c key=value):
    allowed_origins   comma-separated extra CORS origins (e.g. the Amplify domain)
    bedrock_model_id  Bedrock model or inference profile id for briefs
"""

from pathlib import Path

from aws_cdk import (
    CfnOutput,
    Duration,
    RemovalPolicy,
    Stack,
    aws_apigatewayv2 as apigw,
    aws_apigatewayv2_integrations as integrations,
    aws_iam as iam,
    aws_lambda as lambda_,
    aws_logs as logs,
    aws_s3 as s3,
    aws_s3_deployment as s3deploy,
)
from constructs import Construct

ROOT = Path(__file__).resolve().parents[2]
EXPORT_DIR = ROOT / "pipeline" / "data" / "export"
API_DIR = ROOT / "api"
DATA_PREFIX = "data/"
LOCAL_ORIGINS = ["http://localhost:5173", "http://localhost:4173"]
DEFAULT_MODEL_ID = "in.anthropic.claude-haiku-4-5-20251001-v1:0"


class EmissionWatchStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        if not (EXPORT_DIR / "clusters.json").exists():
            raise FileNotFoundError(f"{EXPORT_DIR} has no clusters.json; run `python -m src.export.to_json` in pipeline/ first")
        model_id = self.node.try_get_context("bedrock_model_id") or DEFAULT_MODEL_ID
        extra = self.node.try_get_context("allowed_origins") or ""
        origins = LOCAL_ORIGINS + [o.strip().rstrip("/") for o in extra.split(",") if o.strip()]

        # ---------- Data bucket: private, encrypted, TLS only ----------
        bucket = s3.Bucket(
            self,
            "DataBucket",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
            enforce_ssl=True,
            versioned=False,
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
        )
        s3deploy.BucketDeployment(
            self,
            "DeployExport",
            sources=[s3deploy.Source.asset(str(EXPORT_DIR), exclude=["*", "!*.json"])],
            destination_bucket=bucket,
            destination_key_prefix=DATA_PREFIX,
            prune=True,
            memory_limit=256,
        )

        # ---------- API Lambda ----------
        log_group = logs.LogGroup(
            self, "ApiLogs", retention=logs.RetentionDays.TWO_WEEKS, removal_policy=RemovalPolicy.DESTROY
        )
        fn = lambda_.Function(
            self,
            "ApiFunction",
            runtime=lambda_.Runtime.PYTHON_3_12,
            architecture=lambda_.Architecture.ARM_64,
            handler="handlers.app.handler",
            code=lambda_.Code.from_asset(
                str(API_DIR),
                exclude=[".venv", ".venv/**", "tests", "tests/**", "**/__pycache__", ".pytest_cache", "pytest.ini", "requirements*.txt"],
            ),
            memory_size=256,
            timeout=Duration.seconds(10),
            log_group=log_group,
            environment={
                "DATA_BUCKET": bucket.bucket_name,
                "DATA_PREFIX": DATA_PREFIX,
                "BEDROCK_MODEL_ID": model_id,
                "BEDROCK_REGION": self.region,
                "CACHE_TTL_SECONDS": "300",
            },
        )

        # Least privilege: read objects under data/ in this bucket; invoke the one Bedrock model.
        fn.add_to_role_policy(
            iam.PolicyStatement(actions=["s3:GetObject"], resources=[bucket.arn_for_objects(f"{DATA_PREFIX}*")])
        )
        foundation_id = model_id.split(".", 1)[1] if model_id.split(".", 1)[0] in ("in", "apac", "us", "eu", "global") else model_id
        fn.add_to_role_policy(
            iam.PolicyStatement(
                # Converse is authorised by bedrock:InvokeModel.
                actions=["bedrock:InvokeModel"],
                resources=[
                    # Cross-region inference profile in this account/region, and the model it routes to.
                    f"arn:aws:bedrock:{self.region}:{self.account}:inference-profile/{model_id}",
                    f"arn:aws:bedrock:*::foundation-model/{foundation_id}",
                ],
            )
        )

        # ---------- HTTP API ----------
        api = apigw.HttpApi(
            self,
            "HttpApi",
            api_name="emissionwatch-api",
            create_default_stage=False,
            cors_preflight=apigw.CorsPreflightOptions(
                allow_origins=origins,
                allow_methods=[apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST, apigw.CorsHttpMethod.OPTIONS],
                allow_headers=["content-type"],
                max_age=Duration.hours(1),
            ),
        )
        integration = integrations.HttpLambdaIntegration("ApiIntegration", fn)
        for path, method in [
            ("/clusters", apigw.HttpMethod.GET),
            ("/clusters/{id}", apigw.HttpMethod.GET),
            ("/clusters/{id}/timeseries", apigw.HttpMethod.GET),
            ("/summary", apigw.HttpMethod.GET),
            ("/brief/{id}", apigw.HttpMethod.POST),
        ]:
            api.add_routes(path=path, methods=[method], integration=integration)

        # Throttling protects credits: 10 rps / burst 20 overall, briefs (Bedrock) 1 rps / burst 2.
        stage = apigw.HttpStage(
            self,
            "DefaultStage",
            http_api=api,
            stage_name="$default",
            auto_deploy=True,
            throttle=apigw.ThrottleSettings(rate_limit=10, burst_limit=20),
        )
        stage.node.default_child.add_property_override(
            "RouteSettings", {"POST /brief/{id}": {"ThrottlingRateLimit": 1, "ThrottlingBurstLimit": 2}}
        )

        CfnOutput(self, "ApiUrl", value=api.api_endpoint, description="Set as VITE_API_URL")
        CfnOutput(self, "BucketName", value=bucket.bucket_name)
        CfnOutput(self, "AllowedOrigins", value=",".join(origins))
