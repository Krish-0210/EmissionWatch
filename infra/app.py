#!/usr/bin/env python3
"""CDK app: EmissionWatchStack in ap-south-1 (account from the emissionwatch profile)."""

import os

import aws_cdk as cdk

from infra.emissionwatch_stack import EmissionWatchStack

app = cdk.App()
EmissionWatchStack(
    app,
    "EmissionWatchStack",
    env=cdk.Environment(account=os.getenv("CDK_DEFAULT_ACCOUNT"), region="ap-south-1"),
    description="EmissionWatch: S3 data, API Lambda (read + Bedrock briefs), HTTP API",
)
cdk.Tags.of(app).add("project", "emissionwatch")
app.synth()
