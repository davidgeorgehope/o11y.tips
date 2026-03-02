#!/usr/bin/env python3
"""Reddit Opportunity Spotter for o11y.tips

Scans target subreddits for questions David can meaningfully answer.
Categorizes opportunities and drafts responses.
Outputs a WhatsApp-ready digest.
"""
import json
import os
import re
import sqlite3
import sys
import time
import urllib.request
from datetime import datetime, timezone, timedelta
from typing import Optional

# --- Config ---
SUBREDDITS = [
    "devops", "observability", "sre", "kubernetes", "opentelemetry",
    "prometheus", "grafana", "elasticsearch", "platformengineering"
]
POSTS_PER_SUB = 25  # fetch from both /new and /hot
MIN_SCORE = 1       # minimum upvotes to consider
MAX_AGE_HOURS = 48  # only look at recent posts
MAX_OPPORTUNITIES = 5  # max items in digest
USER_AGENT = "o11y-spotter:v1.0 (educational content research)"

O11Y_DB = "/root/o11y.tips/data/content-engine.db"
DAVID_BLOG = "https://davidgeorgehope.com"
O11Y_TIPS = "https://o11y.tips"

# David's expertise areas (for matching even without o11y.tips articles)
EXPERTISE = [
    "opentelemetry", "otel", "observability", "elastic", "elasticsearch",
    "kibana", "apm", "distributed tracing", "metrics", "logging",
    "slo", "sli", "sre", "instrumentation", "collector", "otlp",
    "cardinality", "kubernetes monitoring", "llm observability",
    "ai observability", "ebpf"
]

def fetch_reddit(subreddit: str, sort: str = "new", limit: int = 25) -> list:
    """Fetch posts from a subreddit via JSON API."""
    url = f"https://www.reddit.com/r/{subreddit}/{sort}.json?limit={limit}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
            return [p["data"] for p in data.get("data", {}).get("children", [])]
    except Exception as e:
        print(f"  ⚠️  Failed to fetch r/{subreddit}/{sort}: {e}", file=sys.stderr)
        return []

def is_question_or_help(post: dict) -> bool:
    """Check if a post is seeking help or asking a question."""
    title = post.get("title", "").lower()
    text = post.get("selftext", "").lower()
    combined = f"{title} {text}"
    
    # Question indicators
    question_signals = [
        "?", "how to", "how do", "how can", "why does", "why is",
        "help", "struggling", "issue with", "problem with", "trouble",
        "not working", "anyone know", "best way to", "recommended",
        "advice", "suggestion", "what is the", "which", "should i",
        "looking for", "trying to", "can't figure", "confused about",
        "explain", "difference between", "vs", "versus", "compare",
        "alternative", "migrate", "migration"
    ]
    
    # Skip low-quality posts
    skip_signals = [
        "hiring", "job", "resume", "salary", "interview",
        "meme", "shitpost", "rant", "[meta]"
    ]
    
    if any(s in combined for s in skip_signals):
        return False
    
    return any(s in combined for s in question_signals)

def is_relevant_to_expertise(post: dict) -> bool:
    """Check if post matches David's expertise areas."""
    combined = f"{post.get('title', '')} {post.get('selftext', '')}".lower()
    return any(kw in combined for kw in EXPERTISE)

def get_published_articles() -> list:
    """Get published o11y.tips articles from the database."""
    if not os.path.exists(O11Y_DB):
        return []
    try:
        conn = sqlite3.connect(O11Y_DB)
        cursor = conn.execute(
            "SELECT slug, title, description, content FROM content WHERE status='published'"
        )
        articles = [
            {"slug": r[0], "title": r[1], "description": r[2] or "",
             "url": f"{O11Y_TIPS}/observability/{r[0]}",
             "content_preview": (r[3] or "")[:500]}
            for r in cursor.fetchall()
        ]
        conn.close()
        return articles
    except Exception as e:
        print(f"  ⚠️  DB error: {e}", file=sys.stderr)
        return []

def categorize_and_draft(posts: list, articles: list) -> list:
    """Use Gemini to categorize opportunities and draft responses."""
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        print("  ⚠️  google-genai not available, using basic matching", file=sys.stderr)
        return basic_categorize(posts, articles)
    
    # Load API key
    api_key = os.environ.get("GOOGLE_AI_API_KEY")
    if not api_key:
        # Try loading from vibecaster .env
        env_path = "/root/vibecaster/backend/.env"
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    if line.startswith("GOOGLE_AI_API_KEY="):
                        api_key = line.split("=", 1)[1].strip().strip('"')
        # Also try o11y.tips .env
        if not api_key:
            env_path = "/root/o11y.tips/.env"
            if os.path.exists(env_path):
                with open(env_path) as f:
                    for line in f:
                        if line.startswith("GOOGLE_AI_API_KEY="):
                            api_key = line.split("=", 1)[1].strip().strip('"')
    
    if not api_key:
        print("  ⚠️  No Gemini API key found", file=sys.stderr)
        return basic_categorize(posts, articles)
    
    client = genai.Client(api_key=api_key)
    
    articles_context = "\n".join([
        f"- [{a['title']}]({a['url']}): {a['description']}"
        for a in articles
    ]) or "No articles published yet."
    
    posts_context = "\n\n".join([
        f"POST {i+1}:\n"
        f"Subreddit: r/{p['subreddit']}\n"
        f"Title: {p['title']}\n"
        f"Score: {p['score']} | Comments: {p['num_comments']}\n"
        f"URL: https://reddit.com{p['permalink']}\n"
        f"Content: {(p.get('selftext', '') or '')[:800]}"
        for i, p in enumerate(posts)
    ])
    
    prompt = f"""You are helping David, an observability expert (Director of Product Marketing at Elastic, deep OTel/SRE knowledge), find Reddit threads where he can genuinely contribute.

DAVID'S PUBLISHED ARTICLES:
{articles_context}

DAVID'S EXPERTISE:
OpenTelemetry, distributed tracing, observability architecture, Elastic stack, Kubernetes monitoring, LLM/AI observability, SRE practices, instrumentation patterns, cardinality management, eBPF.

REDDIT POSTS TO EVALUATE:
{posts_context}

For each post, decide:
1. Is this a genuine opportunity where David can add real value? (skip low-quality, already-answered, or off-topic posts)
2. Categorize as:
   - "just_answer" (70% of picks) — answer helpfully with no self-links. Build credibility.
   - "link_others" (20% of picks) — link to great external resources (official docs, CNCF talks, other blogs). Be a curator.
   - "link_own" (10% of picks) — ONLY when David's o11y.tips article is genuinely the best answer. Rare!
3. Draft a response in David's voice: casual, knowledgeable, direct, occasionally witty. British but not stuffy. No corporate speak.

Return JSON array (pick the best {MAX_OPPORTUNITIES}, ranked by opportunity quality):
[
  {{
    "post_index": 1,
    "category": "just_answer",
    "why_engage": "Brief explanation of why this is worth David's time",
    "draft_response": "The actual response David could post (he'll edit it)",
    "relevant_link": "URL to link if category is link_others or link_own, null otherwise",
    "link_context": "Why this link is relevant (if applicable)",
    "engagement_score": 8
  }}
]

RULES:
- Be VERY selective. Only pick posts where David can genuinely shine.
- Prefer posts with some engagement (>2 upvotes, some comments) but where the top answer is incomplete or wrong.
- Draft responses should be 2-6 sentences. Helpful, not essays.
- For "link_own", ONLY use articles from David's published list above.
- For "link_others", suggest specific URLs (official docs, well-known blog posts, conference talks).
- If fewer than {MAX_OPPORTUNITIES} posts are worth engaging with, return fewer. Quality over quantity.
- NEVER suggest posts about hiring, salary, or career advice.
"""
    
    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.4,
                response_mime_type="application/json",
            )
        )
        
        results = json.loads(response.text)
        
        # Enrich with original post data
        for r in results:
            idx = r.get("post_index", 1) - 1
            if 0 <= idx < len(posts):
                p = posts[idx]
                r["reddit_url"] = f"https://reddit.com{p['permalink']}"
                r["subreddit"] = p["subreddit"]
                r["title"] = p["title"]
                r["score"] = p["score"]
                r["num_comments"] = p["num_comments"]
        
        return results
        
    except Exception as e:
        print(f"  ⚠️  Gemini categorization failed: {e}", file=sys.stderr)
        return basic_categorize(posts, articles)

def basic_categorize(posts: list, articles: list) -> list:
    """Fallback categorization without LLM."""
    results = []
    for i, p in enumerate(posts[:MAX_OPPORTUNITIES]):
        results.append({
            "post_index": i + 1,
            "category": "just_answer",
            "why_engage": "Matches expertise area",
            "draft_response": "",
            "reddit_url": f"https://reddit.com{p['permalink']}",
            "subreddit": p["subreddit"],
            "title": p["title"],
            "score": p["score"],
            "num_comments": p["num_comments"],
        })
    return results

def format_digest(opportunities: list) -> str:
    """Format opportunities as a WhatsApp-friendly digest."""
    if not opportunities:
        return "🔍 *Reddit Spotter* — No great opportunities today. The subs were quiet (or boring)."
    
    category_emoji = {
        "just_answer": "💬",
        "link_others": "🔗",
        "link_own": "⭐"
    }
    
    category_label = {
        "just_answer": "Just Answer",
        "link_others": "Share Resource",
        "link_own": "Your Content Fits"
    }
    
    lines = [f"🔍 *Reddit Spotter* — {len(opportunities)} opportunities found\n"]
    
    for i, opp in enumerate(opportunities, 1):
        cat = opp.get("category", "just_answer")
        emoji = category_emoji.get(cat, "💬")
        label = category_label.get(cat, "Engage")
        
        lines.append(f"*{i}. {emoji} {label}* — r/{opp.get('subreddit', '?')}")
        lines.append(f"📌 _{opp.get('title', 'Untitled')}_")
        lines.append(f"👍 {opp.get('score', 0)} pts · 💬 {opp.get('num_comments', 0)} comments")
        lines.append(f"🔗 {opp.get('reddit_url', '')}")
        
        if opp.get("why_engage"):
            lines.append(f"\n*Why:* {opp['why_engage']}")
        
        if opp.get("draft_response"):
            lines.append(f"\n*Draft:*\n{opp['draft_response']}")
        
        if opp.get("relevant_link"):
            lines.append(f"\n*Link to share:* {opp['relevant_link']}")
            if opp.get("link_context"):
                lines.append(f"_{opp['link_context']}_")
        
        lines.append("")  # blank line between items
    
    lines.append("_Edit the drafts, add your take, post from your account. 🦉_")
    
    return "\n".join(lines)

def main():
    print("🔍 Reddit Opportunity Spotter starting...", file=sys.stderr)
    
    # 1. Scan subreddits
    all_posts = []
    cutoff = datetime.now(timezone.utc) - timedelta(hours=MAX_AGE_HOURS)
    
    for sub in SUBREDDITS:
        print(f"  Scanning r/{sub}...", file=sys.stderr)
        
        for sort in ["hot", "new"]:
            posts = fetch_reddit(sub, sort, POSTS_PER_SUB)
            for p in posts:
                created = datetime.fromtimestamp(p.get("created_utc", 0), tz=timezone.utc)
                if created < cutoff:
                    continue
                if p.get("score", 0) < MIN_SCORE:
                    continue
                if not is_question_or_help(p):
                    continue
                if not is_relevant_to_expertise(p):
                    continue
                all_posts.append(p)
            
            time.sleep(0.5)  # rate limiting
    
    # Deduplicate by post ID
    seen_ids = set()
    unique_posts = []
    for p in all_posts:
        if p["id"] not in seen_ids:
            seen_ids.add(p["id"])
            unique_posts.append(p)
    
    # Sort by engagement (score * comments)
    unique_posts.sort(key=lambda p: p.get("score", 0) * max(p.get("num_comments", 1), 1), reverse=True)
    
    print(f"  Found {len(unique_posts)} relevant posts across {len(SUBREDDITS)} subreddits", file=sys.stderr)
    
    if not unique_posts:
        print(format_digest([]))
        return
    
    # Cap at reasonable number for LLM
    candidates = unique_posts[:15]
    
    # 2. Get published articles
    articles = get_published_articles()
    print(f"  {len(articles)} published o11y.tips articles for matching", file=sys.stderr)
    
    # 3. Categorize and draft
    print("  🤖 Analyzing with Gemini...", file=sys.stderr)
    opportunities = categorize_and_draft(candidates, articles)
    
    # 4. Format digest
    digest = format_digest(opportunities)
    print(digest)

if __name__ == "__main__":
    main()
