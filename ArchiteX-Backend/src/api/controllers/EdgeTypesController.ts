import type { Request, Response } from "express";
import type { EdgeTypesResponseDto } from "../dto/palette.dto";

/**
 * GET /api/v1/edge-types — ApiContract.md §6
 *
 * Returns all valid edge types with metadata for the canvas palette.
 * Colors match the spec exactly (ApiContract.md §6 Full Response Example).
 */

const EDGE_TYPES_RESPONSE: EdgeTypesResponseDto = {
  edgeTypes: [
    { type: "Traffic",      label: "Traffic",       description: "Generic HTTP / TCP traffic",                  directed: true, defaultColor: "#6366F1" },
    { type: "Reads",        label: "Reads",         description: "Data read operation",                         directed: true, defaultColor: "#22C55E" },
    { type: "Writes",       label: "Writes",        description: "Data write operation",                        directed: true, defaultColor: "#EF4444" },
    { type: "Calls",        label: "Calls",         description: "Synchronous RPC / API call",                  directed: true, defaultColor: "#F59E0B" },
    { type: "ReplicatesTo", label: "Replicates To", description: "Data replication link",                       directed: true, defaultColor: "#8B5CF6" },
    { type: "Publishes",    label: "Publishes",     description: "Message publication",                         directed: true, defaultColor: "#06B6D4" },
    { type: "Consumes",     label: "Consumes",      description: "Message consumption",                         directed: true, defaultColor: "#0EA5E9" },
    { type: "Streams",      label: "Streams",       description: "Streaming data flow",                         directed: true, defaultColor: "#14B8A6" },
    { type: "Proxies",      label: "Proxies",       description: "Traffic proxying (ServiceMesh, CircuitBreaker)", directed: true, defaultColor: "#A855F7" },
  ],
};

export class EdgeTypesController {
  handle = (_req: Request, res: Response): void => {
    res.status(200).json(EDGE_TYPES_RESPONSE);
  };
}
