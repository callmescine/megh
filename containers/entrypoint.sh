#!/bin/bash
set -e

# ---------------------------------------------------------------------------
# Claude Code initialization
# ---------------------------------------------------------------------------
# The CLAUDE_CODE_OAUTH_TOKEN env var is injected by the platform at container
# creation time. We run `claude -p` once to validate the token and cache the
# oauthAccount, then re-apply our onboarding/trust config on top (claude -p
# overwrites .claude.json so we must patch AFTER it runs).

if [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
    echo "[Megh] Initializing Claude Code with OAuth token..."

    # Run claude -p to validate token and populate oauthAccount
    claude -p "hi" --dangerously-skip-permissions > /dev/null 2>&1 || true

    # Re-apply onboarding + trust config (claude -p overwrites .claude.json)
    python3 -c "
import json, os
p = '/home/agent/.claude.json'
d = {}
if os.path.exists(p):
    with open(p) as f:
        d = json.load(f)
d['hasCompletedOnboarding'] = True
d['theme'] = 'dark'
d['numStartups'] = 1
d['lastOnboardingVersion'] = '2.1.63'
d.setdefault('projects', {})
d['projects']['/home/agent/workspace'] = {
    'allowedTools': [],
    'hasTrustDialogAccepted': True,
    'projectOnboardingSeenCount': 1
}
with open(p, 'w') as f:
    json.dump(d, f, indent=2)
print('[Megh] Claude Code config patched')
"

    echo "[Megh] Claude Code ready"
elif [ -n "$ANTHROPIC_API_KEY" ]; then
    echo "[Megh] Using API key authentication"
fi

# Run setup script if it exists in the workspace
if [ -f /home/agent/workspace/.agent-setup.sh ]; then
    echo "[Megh] Running workspace setup script..."
    bash /home/agent/workspace/.agent-setup.sh
fi

echo "[Megh] Agent container ready"

# Signal to waitForInit() that initialization is complete
echo "ready" > /tmp/_megh_init_done

# Keep container running — wait for exec sessions
exec tail -f /dev/null
