const READ_ONLY_TOOLS = new Set([
	"read",
	"grep",
	"find",
	"ls",
	"agentic_search",
	"ask",
	"questionnaire",
	"get_plan",
	"save_plan",
	"web_search",
	"web_search_summary",
	"web_fetch",
	"perplexity_search",
	"perplexity_fetch",
	"memory_read",
	"memory_search",
	"memory_list",
	"qmd_query",
	"qmd_get",
	"qmd_multi_get",
	"qmd_status",
	"slack_search",
	"slack_history",
	"slack_thread",
	"slack_message",
	"slack_profile",
	"slack_canvas",
	"vault_search",
]);

export function isReadOnlyPlanTool(name: string): boolean {
	return READ_ONLY_TOOLS.has(name);
}
