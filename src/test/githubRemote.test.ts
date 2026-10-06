import * as assert from "assert";
import { parseGithubRemote } from "../github";

suite("parseGithubRemote", () => {
  test("acepta SSH, HTTPS y git protocol", () => {
    const expected = { owner: "acme", repo: "front" };
    assert.deepStrictEqual(parseGithubRemote("git@github.com:acme/front.git"), expected);
    assert.deepStrictEqual(parseGithubRemote("https://github.com/acme/front.git"), expected);
    assert.deepStrictEqual(parseGithubRemote("https://github.com/acme/front"), expected);
    assert.deepStrictEqual(
      parseGithubRemote("ssh://git@github.com/acme/front.git"),
      expected
    );
    assert.deepStrictEqual(parseGithubRemote("git://github.com/acme/front.git"), expected);
  });

  test("rechaza remotes que no son GitHub", () => {
    assert.strictEqual(parseGithubRemote("git@gitlab.com:acme/front.git"), undefined);
    assert.strictEqual(parseGithubRemote(""), undefined);
  });
});
