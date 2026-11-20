from __future__ import annotations

import importlib.metadata
import platform
from typing import Any


def get_installed_version(package: str) -> str:
    try:
        return importlib.metadata.version(package)
    except importlib.metadata.PackageNotFoundError:
        return "not-installed"


CITATION_CATALOG: dict[str, dict[str, str]] = {
    "numpy": {
        "role": "core",
        "citation": (
            "Harris CR, Millman KJ, van der Walt SJ, et al. Array programming with NumPy. "
            "Nature. 2020;585(7825):357-362."
        ),
    },
    "pandas": {
        "role": "core",
        "citation": (
            "McKinney W. Data structures for statistical computing in Python. "
            "Proc. 9th Python in Science Conf. (SciPy 2010). 2010:56-61."
        ),
    },
    "scipy": {
        "role": "core",
        "citation": (
            "Virtanen P, Gommers R, Oliphant TE, et al. SciPy 1.0: fundamental algorithms for "
            "scientific computing in Python. Nature Methods. 2020;17(3):261-272."
        ),
    },
    "statsmodels": {
        "role": "modeling",
        "citation": (
            "Seabold S, Perktold J. Statsmodels: Econometric and statistical modeling with Python. "
            "Proc. 9th Python in Science Conf. (SciPy 2010). 2010:92-96."
        ),
    },
    "lifelines": {
        "role": "survival",
        "citation": (
            "Davidson-Pilon C. lifelines: survival analysis in Python. "
            "Journal of Open Source Software. 2019;4(40):1317."
        ),
    },
    "scikit-learn": {
        "role": "metrics",
        "citation": (
            "Pedregosa F, Varoquaux G, Gramfort A, et al. Scikit-learn: Machine Learning in Python. "
            "Journal of Machine Learning Research. 2011;12:2825-2830."
        ),
    },
}


def build_library_citations(methods_by_pkg: list[tuple[str, str]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    citations: list[dict[str, Any]] = []
    for pkg, method in methods_by_pkg:
        if pkg in seen:
            continue
        seen.add(pkg)
        meta = CITATION_CATALOG.get(pkg, {"role": "core", "citation": pkg})
        citations.append(
            {
                "package": pkg,
                "version": get_installed_version(pkg),
                "method": method,
                "citation": meta["citation"],
                "role": meta["role"],
            }
        )
    return citations


def runtime_metadata() -> dict[str, str]:
    return {
        "engine": "python-scientific",
        "engine_version": f"python-{platform.python_version()}",
        "runtime": f"Python {platform.python_version()} ({platform.system()} {platform.machine()})",
    }
