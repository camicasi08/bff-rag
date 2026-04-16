import { getBffBaseUrl } from './config';

type GraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

export async function graphqlRequest<TData>(
  query: string,
  variables: Record<string, unknown>,
  accessToken?: string,
): Promise<TData> {
  const response = await fetch(`${getBffBaseUrl()}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = (await response.json()) as GraphqlResponse<TData>;
  if (!response.ok || payload.errors?.length) {
    const detail = payload.errors?.[0]?.message ?? `GraphQL request failed with ${response.status}`;
    throw new Error(detail);
  }

  if (!payload.data) {
    throw new Error('GraphQL response did not include data');
  }

  return payload.data;
}
