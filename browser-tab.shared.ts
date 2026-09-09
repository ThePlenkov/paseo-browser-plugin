import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

// Get the bridge server URL for embedding in an iframe
export const browserGetUrl = defineRpc({
  name: "browser-tab.get-url",
  input: z.object({}),
  output: z.object({
    url: z.string(),
    error: z.string().nullable(),
  }),
});
