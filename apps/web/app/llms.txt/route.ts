import { llmsResponse, llmsTxt } from "@/lib/llms";

export const GET = (request: Request) => llmsResponse(request, llmsTxt);
