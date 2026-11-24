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

  async get<T = any>(url: string, config?: any): Promise<T> {
    const response = await this.axiosInstance.get(url, config);
    return response.data;
  }

  async post<T = any>(url: string, data?: any, config?: any): Promise<T> {
    const response = await this.axiosInstance.post(url, data, config);
    return response.data;
  }

  async postText(
    url: string,
    data?: any,
    config?: any,
  ): Promise<{ text: string; contentType?: string; interruption?: Error }> {
    let response: any;
    try {
      response = await this.axiosInstance.post(url, data, {
        ...config,
        responseType: "stream",
      });
    } catch (error: any) {
      if (isReadableStream(error.response?.data)) {
        const { text } = await readStreamKeepingPartialText(
          error.response.data,
        );
        error.response.data = parseJsonOrText(text);
      }
      throw error;
    }

    return {
      ...(await readStreamKeepingPartialText(response.data)),
      contentType: response.headers["content-type"],
    };
  }

  async put<T = any>(url: string, data?: any, config?: any): Promise<T> {
    const response = await this.axiosInstance.put(url, data, config);
    return response.data;
  }

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

  async patch<T = any>(url: string, data?: any, config?: any): Promise<T> {
    const response = await this.axiosInstance.patch(url, data, config);
    return response.data;
  }

  getAxiosInstance(): any {
    return this.axiosInstance;
  }

  static createInfluxClient(
    baseUrl: string,
    token: string,
    influxType?: string,
  ): HttpClientService {
    return new HttpClientService(baseUrl, token, influxType);
  }
}

function isReadableStream(value: any): boolean {
  return typeof value?.on === "function";
}

async function readStreamKeepingPartialText(
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
