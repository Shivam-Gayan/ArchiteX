/**
 * DTOs for GET /node-types — ApiContract.md §5.
 */
export interface NodeTypeDto {
  type: string;
  label: string;
  description: string;
  category: string;
  icon: string;
}

export interface NodeTypesResponseDto {
  nodeTypes: NodeTypeDto[];
}

/**
 * DTOs for GET /edge-types — ApiContract.md §6.
 */
export interface EdgeTypeDto {
  type: string;
  label: string;
  description: string;
  directed: boolean;
  defaultColor: string;
}

export interface EdgeTypesResponseDto {
  edgeTypes: EdgeTypeDto[];
}
