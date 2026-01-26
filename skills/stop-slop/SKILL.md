# Stop Slop Skill

Remove AI writing patterns ("slop") from prose to make content sound more natural and human-written.

## Invocation

Use `/stop-slop` when drafting, editing, or reviewing text to eliminate predictable AI tells.

## What It Does

1. **Detects** common AI writing patterns:
   - Hedging phrases ("It's worth noting", "In general")
   - Filler transitions ("Let's dive in", "Moving on")
   - Buzzwords and jargon ("leverage", "robust", "seamless")
   - Excessive enthusiasm ("exciting", "amazing")
   - Clichés ("at the end of the day", "tip of the iceberg")

2. **Scores** content on a 0-10 scale (lower is better)

3. **Rewrites** content to remove slop while preserving meaning

## Usage

### Analyze Content
```
/stop-slop analyze

[Paste your content here]
```

### Auto-Fix Content
```
/stop-slop fix

[Paste your content here]
```

## Example

**Before:**
> It's worth noting that leveraging these robust tools can be a game-changer for your workflow. Let's dive into how to utilize them effectively.

**After:**
> These tools improve your workflow significantly. Here's how to use them.

## Configuration

Set the maximum acceptable slop score in settings:
- Default threshold: 5
- Recommended for technical content: 3-5
- Strict mode: 2-3

## Integration

This skill integrates with the content generation pipeline:
- Runs automatically during quality validation
- Content must pass slop check before publishing
- Can be triggered manually during review
