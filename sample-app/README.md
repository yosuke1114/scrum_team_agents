# task-cli

A simple task management CLI tool - sample app for the scrum-team agents system.

## Setup

```bash
cd sample-app
npm install
npm run build
```

## Usage

```bash
# Add tasks
node dist/index.js add "Buy milk" --priority high
node dist/index.js add "Write docs" --tags api,docs

# List tasks
node dist/index.js list
node dist/index.js list --status todo
node dist/index.js list --priority high
node dist/index.js list --tag api

# Update status
node dist/index.js do T-1        # Move to "doing"
node dist/index.js done T-1      # Move to "done"

# Remove
node dist/index.js remove T-1

# Stats
node dist/index.js stats
```

## Testing

```bash
npm test
```

## Architecture

- `src/types.ts` - Type definitions
- `src/store.ts` - JSON-based task persistence
- `src/formatter.ts` - Terminal output formatting
- `src/cli.ts` - Command parsing and routing
- `src/index.ts` - Entry point
