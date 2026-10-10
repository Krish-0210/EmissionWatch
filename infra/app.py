#!/usr/bin/env python3
"""CDK app: PanoptiCoalStack in ap-south-1 (account from the emissionwatch profile)."""

import os

import aws_cdk as cdk

from infra.panopticoal_stack import PanoptiCoalStack

app = cdk.App()
PanoptiCoalStack(
    app,
    "PanoptiCoalStack",
    env=cdk.Environment(account=os.getenv("CDK_DEFAULT_ACCOUNT"), region="ap-south-1"),
    description="PanoptiCoal: S3 data, API Lambda (read + Bedrock briefs), HTTP API",
)
cdk.Tags.of(app).add("project", "panopticoal")
app.synth()
