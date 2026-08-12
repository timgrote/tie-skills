# TIE Skills Repo

Shared Hermes Agent skills for the TIE team.

## Structure

```
skills/
  <category>/
    <skill-name>/
      SKILL.md
      references/    (optional)
      templates/     (optional)
      scripts/       (optional)
```

## Using This Repo

### Option A: External Directory (Dropbox sync)

If you have this folder synced via Dropbox, add it to your Hermes config:

```yaml
# ~/.hermes/config.yaml (or $HERMES_HOME/config.yaml on Windows)
skills:
  external_dirs:
    - D:/Dropbox/TIE/Hermes Skills/skills
```

Skills are scanned live — no install step needed. Edits sync through Dropbox.

### Option B: GitHub Tap

Once pushed to GitHub, others can install individual skills:

```bash
hermes skills tap add yourorg/tie-skills
hermes skills search deploy --source yourorg/tie-skills
hermes skills install yourorg/tie-skills/my-skill
```

## Adding Skills

Drop a new `<skill-name>/SKILL.md` directory under `skills/`. See the
[Hermes skill authoring guide](https://hermes-agent.nousresearch.com/docs/developer-guide/creating-skills)
for the SKILL.md format.
