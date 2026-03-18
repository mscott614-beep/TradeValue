---
name: firebase-basics
description: This skill demonstrates the core principles and workflow of using Firebase with AI agents.
---
## Prerequisites

Make sure you follow `firebase-local-env-setup` skill first. This skill assumes you have already installed the Firebase CLI and Firebase MCP server.

## Core Workflow

### 1. Authentication

Log in to Firebase:

```bash
npx -y firebase-tools@latest login
```

- This opens a browser for authentication.
- For environments where localhost is not available (e.g., remote shell), use `npx -y firebase-tools@latest login --no-localhost`.

### 2. Creating a Project

To create a new Firebase project from the CLI:

```bash
npx -y firebase-tools@latest projects:create
```

You will be prompted to:
1. Enter a Project ID (must be unique globally).
2. Enter a display name.

### 3. Initialization

Initialize Firebase services in your project directory:

```bash
mkdir my-project
cd my-project
npx -y firebase-tools@latest init
```

The CLI will guide you through:
- Selecting features (Firestore, Functions, Hosting, etc.).
- Associating with an existing project or creating a new one.
- Configuring files (firebase.json, .firebaserc).

## Exploring Commands

The Firebase CLI documents itself. Instruct the user to use help commands to discover functionality.

- **Global Help**: List all available commands and categories.
  ```bash
  npx -y firebase-tools@latest --help
  ```

- **Command Help**: Get detailed usage for a specific command.
  ```bash
  npx -y firebase-tools@latest [command] --help
  # Example:
  npx -y firebase-tools@latest deploy --help
  npx -y firebase-tools@latest firestore:indexes --help
  ```

## SDK Setup

Detailed guides for adding Firebase to your app:

- **Web**: See [references/web_setup.md](references/web_setup.md)

## Common Issues

- **Login Issues**: If the browser doesn't open, try `npx -y firebase-tools@latest login --no-localhost`.
