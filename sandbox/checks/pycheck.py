"""Imports every email module the given files import, and binds every call into one.

A call is checked when its target resolves statically from an imported module: a function
or a class reached by attribute access (``resend.Emails.send(params)``,
``SendGridAPIClient(key)``). The installed signature is bound with as many positional
arguments and the same keyword names as the call passes; a bind that fails is a call the
installed version does not accept. Calls on instances are not resolved and are counted as
such. Prints one line: @@PY <json>.
"""
import ast
import importlib
import inspect
import json
import py_compile
import sys

EMAIL_MODULES = {
    "resend", "sendgrid", "postmarker", "postmark", "boto3", "mailjet_rest", "sib_api_v3_sdk", "brevo",
    "brevo_python", "mailersend", "mailtrap", "sparkpost", "fastapi_mail", "aiosmtplib", "smtplib", "yagmail",
    "email",
}


def chain(node):
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return list(reversed(parts))
    return None


def main(files):
    problems, checked, unresolved, imported = [], 0, 0, set()
    for f in files:
        try:
            py_compile.compile(f, doraise=True)
        except py_compile.PyCompileError as e:
            problems.append(f"{f}: does not compile: {e.msg.strip()[:300]}")
            continue
        tree = ast.parse(open(f, encoding="utf8").read(), f)
        names = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for a in node.names:
                    top = a.name.split(".")[0]
                    if top in EMAIL_MODULES:
                        names[a.asname or top] = a.name if a.asname else top
                        imported.add(a.name)
            elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                if node.module.split(".")[0] in EMAIL_MODULES:
                    imported.add(node.module)
                    for a in node.names:
                        names[a.asname or a.name] = f"{node.module}:{a.name}"
        modules = {}
        for target in sorted(set(names.values())):
            mod = target.split(":")[0]
            try:
                modules[mod] = importlib.import_module(mod)
            except Exception as e:  # noqa: BLE001 - any import failure is the finding
                problems.append(f"{f}: import {mod} failed: {type(e).__name__}: {str(e)[:200]}")
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            parts = chain(node.func)
            if not parts or parts[0] not in names:
                continue
            ref = names[parts[0]]
            mod, _, attr = ref.partition(":")
            if mod not in modules:
                continue
            obj = modules[mod]
            try:
                for p in ([attr] if attr else []) + parts[1:]:
                    obj = getattr(obj, p)
            except AttributeError as e:
                problems.append(f"{f}:{node.lineno}: {'.'.join(parts)} does not exist in the installed {mod}: {e}")
                continue
            if not callable(obj):
                continue
            try:
                sig = inspect.signature(obj)
            except (TypeError, ValueError):
                unresolved += 1
                continue
            if any(isinstance(a, ast.Starred) for a in node.args) or any(k.arg is None for k in node.keywords):
                unresolved += 1
                continue
            try:
                sig.bind(*([None] * len(node.args)), **{k.arg: None for k in node.keywords})
                checked += 1
            except TypeError as e:
                problems.append(f"{f}:{node.lineno}: {'.'.join(parts)}{sig} rejects this call: {e}")
    if problems:
        status, detail = "fail", "\n".join(problems)
    elif not imported:
        status, detail = "n/a", "the changed files import no email module"
    else:
        status, detail = "pass", f"imports resolve; {checked} call(s) bind to the installed signatures"
    detail += f"\n{unresolved} call(s) not resolvable statically" if unresolved else ""
    versions = {}
    for m in sorted({i.split(".")[0] for i in imported}):
        try:
            from importlib.metadata import version, packages_distributions
            dists = packages_distributions().get(m, [m])
            versions[m] = version(dists[0])
        except Exception:  # noqa: BLE001 - stdlib modules have no distribution
            pass
    print("@@PY " + json.dumps({"status": status, "tool": "import + signature", "detail": detail, "sdk": versions}))


if __name__ == "__main__":
    main(sys.argv[1:])
