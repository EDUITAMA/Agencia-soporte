import { HttpErrorResponse, type HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { catchError, from, switchMap, throwError } from "rxjs";

import { AxetSessionService } from "./axet-session.service";
import { resolveApiUrl } from "./resolve-api-url";

const API_PATH = "/api/";

// Same contract as the Terpel app: the host JWT is attached to every API call and a
// rejected session sends the user back through the aXet Flows Okta handoff.
export const oktaSessionInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.includes(API_PATH)) return next(request);

  const session = inject(AxetSessionService);

  return from(session.getAuthorizationToken()).pipe(
    switchMap((token) => {
      const url = resolveApiUrl(request.url);
      const headers = request.headers.delete("Authorization");
      return next(request.clone({ url, headers: token ? headers.set("Authorization", `Bearer ${token}`) : headers }));
    }),
    catchError((error: unknown) => {
      if (isRejectedSession(error)) session.requestSignInOnce();
      return throwError(() => error);
    }),
  );
};

function isRejectedSession(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse)) return false;
  if (error.status === 401) return true;
  // The aXet Okta gateway answers rejected tokens with an empty 403; JSON 403s are real authorization errors.
  return error.status === 403 && (error.error === null || error.error === "");
}
