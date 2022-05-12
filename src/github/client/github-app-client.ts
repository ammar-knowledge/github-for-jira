import Logger from "bunyan";
import { Octokit } from "@octokit/rest";
import axios, { AxiosInstance, AxiosRequestConfig, AxiosRequestHeaders, AxiosResponse } from "axios";
import { AppTokenHolder } from "./app-token-holder";
import { handleFailedRequest, instrumentFailedRequest, instrumentRequest, setRequestStartTime, setRequestTimeout } from "./github-client-interceptors";
import { metricHttpRequest } from "config/metric-names";
import { getLogger } from "config/logger";
import { urlParamsMiddleware } from "utils/axios/url-params-middleware";
import { InstallationId } from "./installation-id";

/**
 * A GitHub client that supports authentication as a GitHub app.
 *
 * @see https://docs.github.com/en/developers/apps/building-github-apps/authenticating-with-github-apps
 */
export class GitHubAppClient {
	private readonly axios: AxiosInstance;
	private readonly appTokenHolder: AppTokenHolder;
	private readonly githubInstallationId: InstallationId;
	private readonly logger: Logger;

	constructor(
		githubInstallationId: InstallationId,
		logger: Logger,
		appTokenHolder: AppTokenHolder = AppTokenHolder.getInstance()
	) {
		this.logger = logger || getLogger("github.app.client");

		this.axios = axios.create({
			baseURL: githubInstallationId.githubBaseUrl,
			transitional: {
				clarifyTimeoutError: true
			}
		});

		this.axios.interceptors.request.use(setRequestStartTime);
		this.axios.interceptors.request.use(setRequestTimeout);
		this.axios.interceptors.request.use(urlParamsMiddleware);
		this.axios.interceptors.response.use(
			undefined,
			handleFailedRequest(this.logger)
		);
		this.axios.interceptors.response.use(
			instrumentRequest(metricHttpRequest.github),
			instrumentFailedRequest(metricHttpRequest.github)
		);

		this.axios.interceptors.request.use((config: AxiosRequestConfig) => {
			return {
				...config,
				headers: {
					...config.headers,
					...this.appAuthenticationHeaders()
				}
			};
		});
		this.appTokenHolder = appTokenHolder;
		this.githubInstallationId = githubInstallationId;
	}

	public getUserMembershipForOrg = async (username: string, org: string): Promise<AxiosResponse<Octokit.OrgsGetMembershipResponse>> => {
		return await this.axios.get<Octokit.OrgsGetMembershipResponse>(`/orgs/{org}/memberships/{username}`, {
			urlParams: {
				username,
				org
			}
		});
	};

	public getApp = async (): Promise<AxiosResponse<Octokit.AppsGetAuthenticatedResponse>> => {
		return await this.axios.get<Octokit.AppsGetAuthenticatedResponse>(`/app`, {});
	};

	/**
	 * Use this config in a request to authenticate with the app token.
	 */
	private appAuthenticationHeaders(): Partial<AxiosRequestHeaders> {
		const appToken = this.appTokenHolder.getAppToken(this.githubInstallationId);
		return {
			// Accept: "application/vnd.github.v3+json",
			Accept: "application/vnd.github.machine-man-preview+json",
			Authorization: `Bearer ${appToken.token}`
		};
	}

	/**
	 * This path requires JWT, therefore passing the token directly into the header.
	 */
	public getInstallation = async (installationId: number): Promise<AxiosResponse<Octokit.AppsGetInstallationResponse>> => {
		const response = await this.axios.get<Octokit.AppsGetInstallationResponse>(`/installations/{installationId}`, {
			urlParams: {
				installationId
			}
		});

		return response;
	};

	public getInstallations = async (): Promise<AxiosResponse<Octokit.AppsGetInstallationResponse>> => {
		return await this.axios.get<Octokit.AppsGetInstallationResponse>(`/app/installations`, {});
	};

}
