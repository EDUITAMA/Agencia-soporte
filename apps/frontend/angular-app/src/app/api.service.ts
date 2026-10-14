import { HttpClient } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";

export interface HealthResponse {
  status: "ok";
  service: string;
  timestamp: string;
}

@Injectable({ providedIn: "root" })
export class ApiService {
  private readonly http = inject(HttpClient);

  getHealth(): Promise<HealthResponse> {
    return firstValueFrom(this.http.get<HealthResponse>("/api/health"));
  }
}
