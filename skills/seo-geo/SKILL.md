# SEO/GEO Analyzer Skill

Analyze content for both traditional SEO (Search Engine Optimization) and GEO (Generative Engine Optimization) to maximize discoverability.

## Invocation

Use `/seo` to analyze content for search optimization.

## What It Does

### SEO Analysis
- **Title** optimization (length, keyword placement)
- **Meta description** quality
- **Heading structure** (H1, H2, H3 hierarchy)
- **Keyword density** and placement
- **Content length** and readability
- **Internal/external link** analysis

### GEO Analysis (for AI search engines)
- **Entity recognition** - Are concepts clearly defined?
- **Structured data** readiness
- **Citation quality** - Are claims supported?
- **Factual density** - Information richness
- **Query alignment** - Does content answer likely questions?

## Usage

### Full Analysis
```
/seo analyze

Title: [Your Title]
Description: [Meta description]
Keywords: [target, keywords, here]

[Content to analyze]
```

### Quick Score
```
/seo score

[Content to analyze]
```

### Get Suggestions
```
/seo suggest

[Content to analyze]
```

## Scoring

- **90-100**: Excellent - Ready for publishing
- **70-89**: Good - Minor improvements suggested
- **50-69**: Fair - Needs optimization
- **Below 50**: Poor - Significant work needed

## GEO-Specific Tips

1. **Define entities clearly** - Don't assume AI knows acronyms
2. **Cite sources** - Link to authoritative references
3. **Answer questions directly** - Use clear, structured responses
4. **Use lists and tables** - AI extracts structured data well
5. **Include metadata** - Schema.org markup helps

## Integration

This skill integrates with the content generation pipeline:
- Runs automatically during quality validation
- Content must meet minimum SEO score to publish
- Generates optimization suggestions for review
