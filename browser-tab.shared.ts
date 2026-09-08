import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

export const navigate = defineRpc({
  name: "browser-tab.navigate",
  input: z.object({
    url: z.string(),
    workspaceId: z.string(),
  }),
  output: z.object({
    url: z.string(),
    finalUrl: z.string(),
    status: z.number(),
    contentType: z.string(),
    title: z.string().nullable(),
    html: z.string(),
    error: z.string().nullable(),
  }),
});

export const linkList = defineRpc({
  name: "browser-tab.links",
  input: z.object({
    url: z.string(),
    workspaceId: z.string(),
  }),
  output: z.object({
    links: z.array(
      z.object({
        text: z.string(),
        href: z.string(),
      }),
    ),
    error: z.string().nullable(),
  }),
});
