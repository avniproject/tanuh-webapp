# Release Workflow

My standard process for making and shipping changes. Follow this every time.

1. **Make code changes in the `develop` branch.**
   - Do all development work on `develop`, not directly on `main`.

2. **Test the changes on `develop`.**
   - Verify everything works there before promoting.

3. **Merge `develop` into `main`.**
   - Only merge to `main` once the changes are tested and working.

4. **Tag the version on `main`.**
   - Tag releases using semantic versioning with a `v` prefix, e.g. `v1.5.0`.
   - Example:
     ```bash
     git checkout main
     git tag v1.5.0
     git push origin v1.5.0
     ```

## Summary

`develop` (code + test) → merge to `main` → tag `vX.Y.Z`
