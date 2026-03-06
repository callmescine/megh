FROM ubuntu:24.04

# Avoid interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    python3 \
    python3-pip \
    python3-venv \
    iproute2 \
    sudo \
    wget \
    unzip \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install Claude CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create agent user with restricted sudo (only apt-get and pip3)
RUN useradd -m -s /bin/bash agent && \
    echo "agent ALL=(ALL) NOPASSWD: /usr/bin/apt-get, /usr/bin/pip3" >> /etc/sudoers

# Set up workspace
RUN mkdir -p /home/agent/workspace && \
    chown -R agent:agent /home/agent

# Pre-configure Claude Code: skip onboarding, set theme, pre-accept workspace trust.
# These files are baked into the image so every container starts pre-configured.
# The entrypoint will run `claude -p` to validate the OAuth token, then re-patch
# this config on top (since claude -p overwrites .claude.json).
COPY --chown=agent:agent claude-config.json /home/agent/.claude.json
RUN mkdir -p /home/agent/.claude && chown agent:agent /home/agent/.claude
COPY --chown=agent:agent claude-settings.json /home/agent/.claude/settings.json

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER agent
WORKDIR /home/agent/workspace

ENTRYPOINT ["/entrypoint.sh"]
