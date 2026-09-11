# Collection Workflow

1. Check credentials in `~/.shrimp/leo-job-career/auth/auth-state.json`.
2. Iterate through high-signal search families:
   - Java Agent, Java 智能体, Java 大模型, Java RAG, Java 知识库, Java MCP, AI 应用技术负责人...
3. Pacing: Randomized 1000-2500ms delay between consecutive requests.
4. Auto-checkpointing in `~/.shrimp/leo-job-career/runs/<run_id>/manifest.json`.
5. Pause safely immediately on security checks or captchas.
