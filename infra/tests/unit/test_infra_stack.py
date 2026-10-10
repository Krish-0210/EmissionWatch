import aws_cdk as core
import aws_cdk.assertions as assertions
import pytest

from infra.emissionwatch_stack import EmissionWatchStack


def template(**context):
    app = core.App(context={"allowed_origins": "https://main.example.amplifyapp.com", **context})
    stack = EmissionWatchStack(app, "test", env=core.Environment(account="123456789012", region="ap-south-1"))
    return assertions.Template.from_stack(stack)


def test_bucket_private_encrypted():
    t = template()
    t.has_resource_properties("AWS::S3::Bucket", {
        "PublicAccessBlockConfiguration": {"BlockPublicAcls": True, "BlockPublicPolicy": True, "IgnorePublicAcls": True, "RestrictPublicBuckets": True},
        "BucketEncryption": {"ServerSideEncryptionConfiguration": [{"ServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]},
    })


def test_lambda_config():
    t = template()
    t.has_resource_properties("AWS::Lambda::Function", {
        "Runtime": "python3.12", "Handler": "handlers.app.handler", "Timeout": 10, "MemorySize": 256,
        "Environment": {"Variables": assertions.Match.object_like({
            "BRIEF_MODE": "template", "BEDROCK_MODEL_ID": "in.anthropic.claude-haiku-4-5-20251001-v1:0", "DATA_PREFIX": "data/"})},
    })


def test_brief_mode_context():
    t = template(brief_mode="bedrock")
    t.has_resource_properties("AWS::Lambda::Function", {
        "Environment": {"Variables": assertions.Match.object_like({"BRIEF_MODE": "bedrock"})},
    })
    with pytest.raises(ValueError):
        template(brief_mode="claude")


def test_routes_cors_throttle():
    t = template()
    for key in ["GET /clusters", "GET /clusters/{id}", "GET /clusters/{id}/timeseries", "GET /summary", "POST /brief/{id}"]:
        t.has_resource_properties("AWS::ApiGatewayV2::Route", {"RouteKey": key})
    t.has_resource_properties("AWS::ApiGatewayV2::Api", {"CorsConfiguration": assertions.Match.object_like({
        "AllowOrigins": ["http://localhost:5173", "http://localhost:4173", "https://main.example.amplifyapp.com"]})})
    t.has_resource_properties("AWS::ApiGatewayV2::Stage", {
        "StageName": "$default",
        "DefaultRouteSettings": {"ThrottlingBurstLimit": 20, "ThrottlingRateLimit": 10},
        "RouteSettings": {"POST /brief/{id}": {"ThrottlingRateLimit": 1, "ThrottlingBurstLimit": 2}},
    })


def test_api_role_least_privilege():
    t = template()
    policies = t.find_resources("AWS::IAM::Policy")
    api = [p for k, p in policies.items() if k.startswith("ApiFunction")]
    assert len(api) == 1
    actions = sorted(a for s in api[0]["Properties"]["PolicyDocument"]["Statement"] for a in ([s["Action"]] if isinstance(s["Action"], str) else s["Action"]))
    assert actions == ["bedrock:InvokeModel", "s3:GetObject"]
