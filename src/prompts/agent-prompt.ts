/**
 * Level 2: Agent description This prompt becomes visible to the LLM after the
 * agent router has selected this agent from among others based on their short
 * descriptions. At that point, the LLM gains access to the full list of tools
 * and this detailed prompt, which may include instructions on how to call those
 * tools. In simple scenarios, this prompt can be very short or even empty if
 * the tool descriptions alone are sufficient.
 */

export const AGENT_PROMPT = 'Agent Prompt';
