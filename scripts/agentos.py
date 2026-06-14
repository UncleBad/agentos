#!/usr/bin/env python3
"""
AgentOS Task Runner — delegates tasks to AgentOS subagents via Hermes.

Usage:
    python3 agentos.py <agent> <task-description>
    python3 agentos.py ferret "research the latest Hermes release"
    python3 agentos.py scribe "write a summary of AgentOS"
    python3 agentos.py dev "create a Python script that does X"

The script reads the agent persona from the vault and delegates via
Hermes' delegate_task mechanism.
"""

import sys
import os

AGENTS = {
    "ferret": {
        "persona_file": "/home/omar/BradleyVault/Projects/AgentOS/agents/ferret.md",
        "toolsets": ["web", "terminal", "file"],
    },
    "scribe": {
        "persona_file": "/home/omar/BradleyVault/Projects/AgentOS/agents/scribe.md",
        "toolsets": ["file", "terminal"],
    },
    "dev": {
        "persona_file": "/home/omar/BradleyVault/Projects/AgentOS/agents/dev.md",
        "toolsets": ["terminal", "file", "coding", "web"],
    },
}

def main():
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <agent> <task-description>")
        print(f"Available agents: {', '.join(AGENTS.keys())}")
        sys.exit(1)

    agent_name = sys.argv[1].lower()
    if agent_name not in AGENTS:
        print(f"Unknown agent: {agent_name}")
        print(f"Available: {', '.join(AGENTS.keys())}")
        sys.exit(1)

    task = " ".join(sys.argv[2:])
    agent = AGENTS[agent_name]

    # Read persona
    try:
        with open(agent["persona_file"], "r") as f:
            persona = f.read()
    except FileNotFoundError:
        print(f"Persona file not found: {agent['persona_file']}")
        sys.exit(1)

    # Build context
    context = f"""You are {agent_name.upper()}, an AgentOS subagent.

PERSONA:
{persona}

TASK:
{task}

WORKING DIRECTORY: /home/omar/agentos/
OUTPUT: Write your findings to a file in /home/omar/agentos/ or report back directly.
"""

    # Note: This script is meant to be called from within Hermes via delegate_task.
    # When run standalone, it just prints the context.
    print(f"=== AgentOS Task: {agent_name.upper()} ===")
    print(f"Task: {task}")
    print(f"Toolsets: {', '.join(agent['toolsets'])}")
    print(f"Persona file: {agent['persona_file']}")
    print()
    print("Context prepared. In Hermes, this would be passed to delegate_task.")
    print()
    print(context)

if __name__ == "__main__":
    main()
