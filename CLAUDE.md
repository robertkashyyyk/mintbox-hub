# mintbox-hub (PartsDoc Hub)

## Git & GitHub

- **Never run `gh auth switch`.** This machine has two GitHub accounts; the repo is pinned to `robertkashyyyk` instead.
- The push account is embedded in the origin URL. Check it with `git remote -v`; it should read:
  `https://robertkashyyyk@github.com/robertkashyyyk/mintbox-hub.git`
  If it doesn't, fix it with:
  `git remote set-url origin https://robertkashyyyk@github.com/robertkashyyyk/mintbox-hub.git`
- There is no stored git credential for that account, so a plain `git push` fails ("could not read Password"). Pass the token on the push command only:
  ```
  git -c credential.helper= -c credential.helper='!f() { echo username=robertkashyyyk; echo "password=$(gh auth token --user robertkashyyyk)"; }; f' push -u origin <branch>
  ```
  Nothing is stored and the token isn't printed.
- For every `gh` command, pass the token on that one command only:
  `GH_TOKEN=$(gh auth token --user robertkashyyyk) gh pr create ...`
  (Use the same prefix for `gh pr view`, `gh pr checks` and so on.)
