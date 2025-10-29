"""Collects token usage and latency for agents and workflows."""
from prometheus_client import Counter, Histogram

token_count = Counter("smx_tokens_total", "Total LLM tokens used")
latency = Histogram("smx_response_latency_seconds", "Pipeline latency")
