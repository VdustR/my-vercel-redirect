# My Vercel App for Subdomain Redirects

This is a Vercel application that enables subdomain redirection to other domains using Edge Middleware.

## Usage

- Fork this repository and modify the `myDomain` and `subdomainMap` variables in `middleware.ts`.
- Deploy the forked repository to Vercel and set up the domain listed in the `subdomainMap` variable.

## Local Testing

Requirements: please check the `engines` field in `package.json`.

- Run `pnpm install` to install dependencies.
- Run `pnpm vercel:dev` to start the local development server.
- Add `127.0.0.1 my.domain` to your `/etc/hosts` file and replace `my.domain` with your desired domain.
- Open your browser and visit `http://my.domain:3000`.

Please note that Chrome automatically redirects `.dev` domains to `https`, so you may need to use a different apex domain for local testing.

## Reference

- [Redirects](https://vercel.com/docs/concepts/edge-network/redirects)
- [Edge Middleware](https://vercel.com/docs/concepts/functions/edge-middleware)

## License

The code is licensed under the [MIT License](./LICENSE), and the documentation is licensed under the [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) license.
