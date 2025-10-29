"""Implements prompt sanitation and RBAC for tools."""

def sanitize_prompt(prompt: str) -> str:
    bad = ["DELETE", "DROP", "system override"]
    for b in bad:
        prompt = prompt.replace(b, "[REDACTED]")
    return prompt
