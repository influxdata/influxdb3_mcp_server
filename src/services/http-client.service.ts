/**
 * HTTP Client Service
 *
 * Simple axios-based HTTP client for making authenticated requests to InfluxDB API
 */

import axios, { AxiosInstance } from "axios";
import { InfluxProductType } from "../helpers/enums/influx-product-types.enum.js";
import { Agent } from "https";

export class HttpClientService {
  private axiosInstance: AxiosInstance;

  constructor(baseURL?: string, token?: string, influxType?: string) {
    const axiosConfig: any = {
      baseURL: baseURL?.replace(/\/$/, ""),
      timeout: 30000,
      headers: this.createAuthHeaders(token, influxType),
    };

    if (influxType === InfluxProductType.Clustered) {
      axiosConfig.httpsAgent = new Agent({
        rejectUnauthorized: false,
      });
    }

    this.axiosInstance = axios.create(axiosConfig);

    this.axiosInstance.interceptors.response.use(
      (response: any) => {
        return response;
      },
      (error: any) => {
        return Promise.reject(error);
      },
    );
  }

  /**
   * Create authentication headers with appropriate format for InfluxDB type
   */
  private createAuthHeaders(
    token?: string,
    influxType?: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (token?.trim()) {
      if (influxType === InfluxProductType.CloudServerless) {
        headers["Authorization"] = `Token ${token}`;
      } else {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    return headers;
  }

  /**
   * Make a GET request
   */
  async get<T = any>(url: string, config?: any): Promise<T> {
    const response = await this.axiosInstance.get(url, config);
    return response.data;
  }

  /**
   * Make a POST request
   */
  async post<T = any>(url: string, data?: any, config?: any): Promise<T> {
    const response = await this.axiosInstance.post(url, data, config);
    return response.data;
  }

  /**
   * Make a POST request and read the response body as text.
   *
   * The body is streamed so that a connection that fails after the response
   * began keeps what arrived: the failure is returned as `interruption`
   * instead of thrown. A non-2xx response still throws, with its body read
   * into `error.response.data` (parsed when it is JSON).
   */
  async postText(
    url: string,
    data?: any,
    config?: any,
  ): Promise<{ text: string; interruption?: Error }> {
    let response: any;
    try {
      response = await this.axiosInstance.post(url, data, {
        ...config,
        responseType: "stream",
      });
    } catch (error: any) {
      if (typeof error.response?.data?.on === "function") {
        const { text } = await readStream(error.response.data);
        error.response.data = parseJsonOrText(text);
      }
      throw error;
    }

    return readStream(response.data);
  }

  /**
   * Make a PUT request
   */
  async put<T = any>(url: string, data?: any, config?: any): Promise<T> {
    const response = await this.axiosInstance.put(url, data, config);
    return response.data;
  }

  /**
   * Make a DELETE request
   */
  async delete<T = any>(url: string, config?: any): Promise<T> {
    const deleteConfig = {
      ...config,
      headers: {
        ...config?.headers,
        Connection: "close",
      },
    };
    try {
      const response = await this.axiosInstance.delete(url, deleteConfig);
      return response.data;
    } catch (error: any) {
      if (error.message?.includes("aborted")) {
        return {} as T;
      }
      throw error;
    }
  }

  /**
   * Make a PATCH request
   */
  async patch<T = any>(url: string, data?: any, config?: any): Promise<T> {
    const response = await this.axiosInstance.patch(url, data, config);
    return response.data;
  }

  /**
   * Get the underlying axios instance for advanced usage
   */
  getAxiosInstance(): any {
    return this.axiosInstance;
  }

  /**
   * Create a configured instance for InfluxDB API calls
   */
  static createInfluxClient(
    baseUrl: string,
    token: string,
    influxType?: string,
  ): HttpClientService {
    return new HttpClientService(baseUrl, token, influxType);
  }
}

async function readStream(
  stream: AsyncIterable<Buffer>,
): Promise<{ text: string; interruption?: Error }> {
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of stream) chunks.push(chunk);
    return { text: Buffer.concat(chunks).toString("utf8") };
  } catch (error) {
    return {
      text: Buffer.concat(chunks).toString("utf8"),
      interruption: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

function parseJsonOrText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
