import urlJoin from "url-join";

const myDomain = "vdustr.dev";

type SubdomainOptionsBase =
  | string
  | {
      target: string;
      status?: number;
    };

function defineSubdomainMap<
  T extends {
    [subdomain: string]: SubdomainOptionsBase;
  }
>(
  map: T
): T & {
  [subdomain: string]: SubdomainOptionsBase;
} {
  return map;
}

const defaultStatus = 307;

const subdomainMap = defineSubdomainMap({
  blog: "https://vdustr.dev/blog",
  dc: "https://ganhuaking.tw/",
  fb: "https://fb.me/vdustr",
  gh: "https://github.com/vdustr",
  r: "https://www.reddit.com/u/vp_tw",
  t: "https://twitter.com/vp_tw",
} as const);

export default function middleware(request: Request) {
  const url = new URL(request.url);

  const domain = url.hostname;

  const matchedSubdomainOptions = Object.entries(subdomainMap).flatMap(
    ([subdomain, options]) => {
      if (domain === `${subdomain}.${myDomain}`) {
        return [options];
      }
      return [];
    }
  )[0];

  if (!matchedSubdomainOptions) {
    return new Response(null, {
      status: 404,
    });
  }

  const pathAndHash = `${url.pathname}${url.search}${url.hash}`;

  const target =
    typeof matchedSubdomainOptions === "string"
      ? matchedSubdomainOptions
      : matchedSubdomainOptions.target;
  const status =
    typeof matchedSubdomainOptions === "string"
      ? defaultStatus
      : "status" in matchedSubdomainOptions
      ? matchedSubdomainOptions.status
      : defaultStatus;
  return new Response(null, {
    status,
    headers: {
      Location: urlJoin(target, pathAndHash),
    },
  });
}
