import Logger from "bunyan";
import { getLogger } from "~/src/config/logger";
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { envVars } from "config/env";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { GraphQlQueryResponse } from "~/src/github/client/github-client.types";
import { GithubClientGraphQLError, RateLimitingError } from "~/src/github/client/github-client-errors";

export interface GitHubConfig {
	hostname: string;
	baseUrl: string;
	apiUrl: string;
	graphqlUrl: string;
	proxyBaseUrl?: string;
}

/**
 * A GitHub client superclass to encapsulate what differs between our GH clients
 */
export class GitHubClient {
	protected readonly logger: Logger;
	protected readonly restApiUrl: string;
	protected readonly graphqlUrl: string;
	protected readonly axios: AxiosInstance;

	constructor(
		gitHubConfig: GitHubConfig,
		logger: Logger = getLogger("gitHub-client")
	) {
		this.logger = logger;

		this.restApiUrl = gitHubConfig.apiUrl;
		this.graphqlUrl = gitHubConfig.graphqlUrl;

		this.axios = axios.create({
			baseURL: this.restApiUrl,
			transitional: {
				clarifyTimeoutError: true
			},
			... (gitHubConfig.proxyBaseUrl ? this.buildProxyConfig(gitHubConfig.proxyBaseUrl) : this.getProxyConfig(this.restApiUrl))
		});
	}

	// will be removed once the FF is removed
	public getProxyConfig = (baseUrl: string): Partial<AxiosRequestConfig> => {
		if (new URL(baseUrl).host.endsWith("atlassian.com")) {
			return this.noProxyConfig();
		}
		return this.outboundProxyConfig();
	};

	// will be removed once the FF is removed
	private noProxyConfig = (): Partial<AxiosRequestConfig> => {
		return {
			// Not strictly necessary to set the agent to undefined, just to make it visible.
			httpsAgent: undefined,
			proxy: false
		};
	};

	// will be removed once the FF is removed
	private outboundProxyConfig = (): Partial<AxiosRequestConfig> => {
		const outboundProxyHttpsAgent = envVars.PROXY ? new HttpsProxyAgent(envVars.PROXY) : undefined;
		return {
			// Even though Axios provides the `proxy` option to configure a proxy, this doesn't work and will
			// always cause an HTTP 501 (see https://github.com/axios/axios/issues/3459). The workaround is to
			// create an HttpsProxyAgent and set the `proxy` option to false.
			httpsAgent: outboundProxyHttpsAgent,
			proxy: false
		};
	};

	protected async graphql<T>(query: string, config: AxiosRequestConfig, variables?: Record<string, string | number | undefined>): Promise<AxiosResponse<GraphQlQueryResponse<T>>> {
		const response = await this.axios.post<GraphQlQueryResponse<T>>(this.graphqlUrl,
			{
				query,
				variables
			},
			config);

		const graphqlErrors = response.data?.errors;
		if (graphqlErrors?.length) {
			this.logger.warn({ res: response }, "GraphQL errors");
			if (graphqlErrors.find(err => err.type == "RATE_LIMITED")) {
				return Promise.reject(new RateLimitingError(response));
			}

			const graphQlErrorMessage = graphqlErrors[0].message + (graphqlErrors.length > 1 ? ` and ${graphqlErrors.length - 1} more errors` : "");
			return Promise.reject(new GithubClientGraphQLError(graphQlErrorMessage, graphqlErrors));
		}

		return response;
	}

	private buildProxyConfig(proxyBaseUrl: string): Partial<AxiosRequestConfig> {
		this.logger.info("Using outbound proxy"); // temp logging while FF is not removed to make sure this path is working
		const proxyHttpAgent = new HttpProxyAgent(proxyBaseUrl);
		const proxyHttpsAgent = new HttpsProxyAgent(proxyBaseUrl);
		return {
			// Even though Axios provides the `proxy` option to configure a proxy, this doesn't work and will
			// always cause an HTTP 501 (see https://github.com/axios/axios/issues/3459). The workaround is to
			// create an Http(s?)ProxyAgent and set the `proxy` option to false.
			httpAgent: proxyHttpAgent,
			httpsAgent: proxyHttpsAgent,
			proxy: false
		};
	}
}
