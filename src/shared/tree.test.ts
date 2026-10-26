import { describe, expect, test } from "bun:test";
import { ancestorDirs, buildTree, compareTreePaths, findReadme } from "./tree";

describe("compareTreePaths", () => {
  test("puts directories before files at each level", () => {
    const paths = ["b/x.md", "A.md", "a.md", "c/d.md", "B.md", "b/a/z.ts"];
    expect(paths.sort(compareTreePaths)).toEqual([
      "b/a/z.ts",
      "b/x.md",
      "c/d.md",
      "A.md",
      "a.md",
      "B.md",
    ]);
  });

  test("compares names case-insensitively first", () => {
    expect(["Zeta.md", "alpha.md", "Beta.md"].sort(compareTreePaths)).toEqual([
      "alpha.md",
      "Beta.md",
      "Zeta.md",
    ]);
  });

  test("breaks ties between names that differ only in case by code unit", () => {
    expect(["readme.md", "README.md"].sort(compareTreePaths)).toEqual([
      "README.md",
      "readme.md",
    ]);
  });

  test("treats a path as equal to itself", () => {
    expect(compareTreePaths("doc/A.md", "doc/A.md")).toBe(0);
  });
});

describe("buildTree", () => {
  test("nests files under directories in tree order", () => {
    expect(
      buildTree(["README.md", "doc/B.md", "doc/A.md", "src/x/y.ts"]),
    ).toEqual([
      {
        name: "doc",
        path: "doc",
        children: [
          { name: "A.md", path: "doc/A.md" },
          { name: "B.md", path: "doc/B.md" },
        ],
      },
      {
        name: "src",
        path: "src",
        children: [
          {
            name: "x",
            path: "src/x",
            children: [{ name: "y.ts", path: "src/x/y.ts" }],
          },
        ],
      },
      { name: "README.md", path: "README.md" },
    ]);
  });

  test("returns an empty list for no files", () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe("ancestorDirs", () => {
  test("lists every directory above the files", () => {
    expect(ancestorDirs(["a/b/c.md", "a/d.md", "e.md"])).toEqual(
      new Set(["a", "a/b"]),
    );
  });

  test("is empty for top-level files and for no files", () => {
    expect(ancestorDirs(["e.md"])).toEqual(new Set());
    expect(ancestorDirs([])).toEqual(new Set());
  });
});

describe("findReadme", () => {
  const readme = (...paths: string[]) =>
    findReadme(buildTree(paths)[0]!.children!);

  test("finds README.md in any case", () => {
    expect(readme("d/README.md")).toBe("d/README.md");
    expect(readme("d/Readme.md")).toBe("d/Readme.md");
  });

  test("prefers the exact README.md, else the first in tree order", () => {
    expect(readme("d/README.md", "d/readme.md")).toBe("d/README.md");
    expect(readme("d/readme.md", "d/Readme.md")).toBe("d/Readme.md");
  });

  test("ignores READMEs in subdirectories", () => {
    expect(readme("d/sub/README.md")).toBeNull();
  });

  test("ignores other README names", () => {
    expect(readme("d/README", "d/README.rst", "d/README.markdown")).toBeNull();
  });
});
