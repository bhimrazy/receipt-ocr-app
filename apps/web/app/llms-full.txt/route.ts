import { llmsFullTxt, llmsResponse } from "@/lib/llms";

export const GET = (request: Request) => llmsResponse(request, llmsFullTxt);
