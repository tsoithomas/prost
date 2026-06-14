export interface SnippetDto {
  id: string;
  name: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSnippetRequest {
  name: string;
  body: string;
}

export interface UpdateSnippetRequest {
  name?: string;
  body?: string;
}
