# Copyright (c) 2026 HOOX · AXIS · hoox-sh
# SPDX-License-Identifier: AGPL-3.0-only

# pynescript_runtime.py — runs Pine Script in the browser via Pyodide.
# Loaded by the Pyodide engine after the pynescript wheel is installed via
# micropip from `/vendor/pynescript-*-py3-none-any.whl`.
#
# Refresh the wheel after pyne releases:
#   ./scripts/sync-pyne-wheel.sh
#
# Mirrors the Flask backend's interpret loop (backend/runtime.py +
# evaluator/series).  Exposes:
#
#   run_script(script, bars, mode="interpret") -> JSON str
#
# ``mode``: interpret (default) | compile | auto.
# Browser compile uses the wheel's ``pynescript.compiler`` when NumPy is
# available; pure-numeric compile still needs Numba (not shipped in WASM),
# so auto falls back to interpret. Object-mode compile can run without Numba.

from __future__ import annotations

import hashlib
import json
import re
import sys
import time
import uuid
from collections import deque

_WARNED: set = set()


def _warn_once(message: str) -> None:
    """Warn on stderr once per unique message.

    Used for drawing-registry / GC failures caused by a pyne wheel API change:
    silently swallowing them would let `meta` advertise caps that were never
    actually enforced. Warn-once so a persistent broken wheel does not spam
    every run.
    """
    if message in _WARNED:
        return
    _WARNED.add(message)
    sys.stderr.write(f"[pynescript_runtime] warning: {message}\n")


# --- Lightweight port of backend/series.py ---------------------------------


class PineSeries:
    """Pine Script series — a scalar that supports [n] historical indexing."""

    __hash__ = None  # type: ignore

    def __init__(self, initial_value=None, history_length: int = 1000):
        self.history = deque([initial_value], maxlen=history_length)
        self.current = initial_value

    def update(self, new_value):
        self.current = new_value
        self.history.appendleft(new_value)

    def __getitem__(self, index: int):
        if index < 0:
            raise ValueError("Pine Script does not support negative indexing")
        if index >= len(self.history):
            return None
        return self.history[index]

    def __len__(self):
        return len(self.history)

    def __repr__(self) -> str:
        return f"PineSeries(current={self.current}, len={len(self.history)})"


# --- Lightweight port of backend/evaluator.py -----------------------------


def _patch_evaluator():
    """Monkey-patch NodeLiteralEvaluator so the pynescript runtime can
    accept our custom PineSeries (and the Bar accessor) as series/list
    arguments.  The base class uses ``isinstance(value, list)`` which is
    too strict for our wrapper."""
    from pynescript.ast.evaluator.builtins.arrays import ArrayBuiltinsMixin
    from pynescript.ast.evaluator.builtins.strings import StringBuiltinsMixin
    from pynescript.ast.evaluator.builtins.technical_submodules.core import (
        TechnicalHelpers,
    )

    if getattr(ArrayBuiltinsMixin, "_patched_for_browser", False):
        return

    def _expect_list(self, value, message):
        if isinstance(value, list):
            return value
        if hasattr(value, "history") and hasattr(value, "current"):
            # PineSeries stores newest-first (appendleft). TA functions need
            # oldest-first chronological order.  Also strip the initial None
            # placeholder so statistics.* functions don't choke.
            raw = list(reversed(value.history))
            # Remove leading Nones (the initial PineSeries placeholder)
            while raw and raw[0] is None:
                raw.pop(0)
            return raw
        if hasattr(value, "__iter__") and hasattr(value, "__len__"):
            return list(value)
        self._error(f"{message}. Got: {type(value).__name__}")

    def _expect_int(self, value, message):
        if isinstance(value, dict) and "default" in value:
            return int(value["default"])
        if isinstance(value, bool):
            return int(value)
        if isinstance(value, int):
            return value
        if isinstance(value, float) and value.is_integer():
            return int(value)
        self._error(f"{message}. Got: {type(value).__name__}")

    def _expect_number(self, value, message):
        if isinstance(value, dict) and "default" in value:
            return float(value["default"])
        try:
            return float(value)
        except (TypeError, ValueError):
            self._error(f"{message}. Got: {type(value).__name__}")

    def _expect_series(self, args, length):
        if len(args) != length:
            self._error(f"ta.* function requires {length} argument(s), got {len(args)}")
        series = self._expect_list(args[0], "First argument must be a list (series)")
        period = self._expect_int(
            args[1], "Second argument must be an integer (period)"
        )
        return series, period

    ArrayBuiltinsMixin._expect_list = _expect_list
    StringBuiltinsMixin._expect_int = _expect_int
    TechnicalHelpers._expect_number = _expect_number
    TechnicalHelpers._expect_series = _expect_series
    ArrayBuiltinsMixin._patched_for_browser = True

    # --- Fix _call_builtin: only pass kwargs to handlers that accept them ---
    from pynescript.ast.evaluator.builtins.base import BuiltinDispatchMixin

    def _handler_accepts_kwargs(handler) -> bool:
        """Check if a bound handler accepts keyword arguments.

        Handlers with ``kwargs`` in their parameter list (with a default
        value, e.g. ``kwargs=None``) or ``**kwargs`` can receive kwargs
        from PineScript named arguments.  Handlers that only take
        ``(self, args)`` should not receive kwargs.
        """
        import inspect

        sig = inspect.signature(handler)
        for p in sig.parameters.values():
            if p.name == "kwargs" or p.kind == inspect.Parameter.VAR_KEYWORD:
                return True
        return False

    def _patched_call_builtin(self, name, args, kwargs=None):
        dispatch = self._builtin_dispatch
        if dispatch is None:
            dispatch = self._build_builtin_map()
            self._builtin_dispatch = dispatch
        handler = dispatch.get(name)
        if handler is None:
            msg = (
                f"Unknown built-in function: '{name}'. "
                f"Available modules: math, str, array, ta, input, request, line, box, label, table, strategy. "
                f"Use 'ta.<name>' for technical analysis, 'math.<name>' for math functions."
            )
            raise ValueError(msg)
        if kwargs and _handler_accepts_kwargs(handler):
            return handler(args, kwargs)
        # Standalone functions like color_new(color, transp) expect
        # unpacked args.  Others (e.g. _capture_plot) have their first
        # positional param named ``args`` and expect a single list.
        import types as _types
        import inspect as _inspect

        if not isinstance(handler, _types.MethodType):
            _params = list(_inspect.signature(handler).parameters.values())
            if _params and _params[0].name != "args":
                return handler(*args, **(kwargs or {}))
        result = handler(args)
        # Input handlers (input.int, input.float, etc.) return metadata
        # dicts like {"default": 20, "type": "int", ...}.  PineScript
        # expects them to evaluate to the scalar default value so that
        # expressions like ``dev = mult * ta.stdev(close, length)`` work.
        if isinstance(result, dict) and "default" in result and "type" in result:
            return result["default"]
        return result

    BuiltinDispatchMixin._call_builtin = _patched_call_builtin

    # --- Patch arithmetics: propagate None (PineScript na) ---
    from pynescript.ast.evaluator import expressions as expr_module

    def _none_safe(op_func):
        def safe(a, b):
            if a is None or b is None:
                return None
            # PineScript element-wise: if one operand is a list and the other
            # is a scalar, broadcast the scalar across the list.
            if isinstance(a, list) and not isinstance(b, (list, tuple)):
                return [op_func(x, b) if x is not None else None for x in a]
            if isinstance(b, list) and not isinstance(a, (list, tuple)):
                return [op_func(a, x) if x is not None else None for x in b]
            return op_func(a, b)

        return safe

    for _name in (
        "_OPERATOR_ADD",
        "_OPERATOR_SUB",
        "_OPERATOR_MUL",
        "_OPERATOR_DIV",
        "_OPERATOR_MOD",
    ):
        if hasattr(expr_module, _name):
            setattr(expr_module, _name, _none_safe(getattr(expr_module, _name)))

    # Also patch comparison operators for None (PineScript na comparisons)
    for _name in (
        "_OPERATOR_LT",
        "_OPERATOR_LE",
        "_OPERATOR_GT",
        "_OPERATOR_GE",
        "_OPERATOR_EQ",
        "_OPERATOR_NE",
    ):
        if hasattr(expr_module, _name):
            setattr(expr_module, _name, _none_safe(getattr(expr_module, _name)))

    # --- Fix AdvancedIndicators._builtin_ta_stdev: properly extract series ---
    from pynescript.ast.evaluator.builtins.technical_submodules.advanced import (
        AdvancedIndicators,
    )

    if not getattr(AdvancedIndicators, "_stdev_fixed", False):

        def _patched_builtin_ta_stdev(self, args):
            series, period = self._expect_series(args, length=2)
            return self._stdev(series, period)

        AdvancedIndicators._builtin_ta_stdev = _patched_builtin_ta_stdev
        AdvancedIndicators._stdev_fixed = True


class CustomEvaluator:
    """Wraps NodeLiteralEvaluator to capture plot commands and strategy events."""

    def __init__(self, context=None, data_feed=None, data_provider=None):
        from pynescript.ast.evaluator import NodeLiteralEvaluator
        from pynescript.ast.evaluator.builtins.strategy import StrategyState

        _patch_evaluator()

        # Wrap (not subclass) to avoid multiple-inheritance surprises.
        self._inner = NodeLiteralEvaluator(
            context=context, data_feed=data_feed, data_provider=data_provider
        )
        self.plot_outputs: list[dict] = []
        self._strategy_state = StrategyState()
        self._var_declarations = set()

        # Monkey-patch the inner evaluator's _builtin_plot so plot() calls
        # land in our buffer.  The base class dispatches "plot" to
        # self._builtin_plot, so we rebind the method on the instance.
        inner = self._inner
        plot_outputs = self.plot_outputs
        original_plot = inner._builtin_plot

        def _capture_plot(args, kwargs=None):
            result = original_plot(args, kwargs)
            if args:
                v = args[0]
                # v can be a PineSeries (has .current), a list/deque, or a raw value
                if hasattr(v, "current"):
                    v = v.current
                elif isinstance(v, (list, tuple)) and v:
                    # List result (e.g. from ta.sma): last element is most recent
                    v = v[-1]
                # Extract title from positional args (args[1] is the title string in Pine plot())
                merged = dict(kwargs) if kwargs else {}
                if len(args) > 1 and "title" not in merged:
                    merged["title"] = args[1]
                plot_outputs.append(
                    {
                        "type": "plot",
                        "value": v,
                        "kwargs": merged,
                        "bar_index": _PLOT_BAR_INDEX[0],
                    }
                )
            return result

        inner._builtin_plot = _capture_plot
        # Invalidate dispatch cache so the rebuilt map picks up _capture_plot
        inner._builtin_dispatch = None

    def __getattr__(self, name):
        if name in ("_inner", "plot_outputs", "_strategy_state", "_var_declarations"):
            raise AttributeError(name)
        return getattr(self._inner, name)

    def _builtin_plot(self, args, kwargs=None):
        if not args:
            return None
        value = args[0]
        if hasattr(value, "current"):
            value = value.current
        self.plot_outputs.append(
            {"type": "plot", "value": value, "kwargs": kwargs or {}}
        )
        return None

    def reset_plots(self):
        self.plot_outputs.clear()

    def reset_var_declarations(self):
        self._var_declarations = set()

    def reset_events(self):
        self._strategy_state._events = []


# Per-bar index tracker used by the plot-capture closure
_PLOT_BAR_INDEX = [0]


# --- Helpers for the run loop ---------------------------------------------


class _Namespace:
    """Tiny attribute holder so Pine scripts can read `syminfo.ticker` etc."""

    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


def _export_alerts(evaluator) -> tuple[list, list]:
    """Pine alert() / alertcondition() records from the wheel evaluator."""
    inner = getattr(evaluator, "_inner", evaluator)
    alerts: list = []
    alert_conditions: list = []
    try:
        from pynescript.ast.evaluator.builtins.alerts import (
            export_alerts_from_evaluator,
        )

        alerts = list(export_alerts_from_evaluator(inner) or [])
    except Exception:
        raw = getattr(inner, "get_triggered_alerts", None)
        items = raw() if callable(raw) else getattr(inner, "_triggered_alerts", None) or []
        for a in items or []:
            if hasattr(a, "to_dict"):
                alerts.append(a.to_dict())
            elif isinstance(a, dict):
                alerts.append(dict(a))
    try:
        exp_c = getattr(inner, "export_alert_conditions", None)
        if callable(exp_c):
            alert_conditions = list(exp_c() or [])
    except Exception:
        alert_conditions = []
    return alerts, alert_conditions


# --- The run loop --------------------------------------------------------


def _run_interpret(
    script: str, bars: list[dict], libraries: list | None = None
) -> dict:
    # Build series
    open_series = PineSeries()
    high_series = PineSeries()
    low_series = PineSeries()
    close_series = PineSeries()
    volume_series = PineSeries()

    context: dict = {
        "open": open_series,
        "high": high_series,
        "low": low_series,
        "close": close_series,
        "volume": volume_series,
        "bar_index": 0,
        "time": 0,
        "syminfo": _Namespace(
            ticker="BTCUSDT",
            currency="USD",
            prefix="",
            mintick=0.01,
            pointvalue=1.0,
            description="Synthetic",
            timezone="UTC",
            type="stock",
            session="regular",
        ),
        "timeframe": _Namespace(
            period="D",
            multiplier=1,
            isdaily=True,
            isintraday=False,
            isweekly=False,
            ismonthly=False,
        ),
        "barstate": _Namespace(
            isconfirmed=True, isrealtime=False, isnew=True, islastconfirmedbar=True
        ),
        "chart": _Namespace(isfullscreen=False, leftvisiblebars=0, rightvisiblebars=0),
    }

    evaluator = CustomEvaluator(context=context)

    # Fresh drawing registries so leftover labels/lines from prior runs
    # do not leak into this response (DrawingRegistry is process-global).
    try:
        from pynescript.ast.evaluator.builtins.drawing import DrawingRegistry

        DrawingRegistry.reset()
    except Exception as _reset_err:
        _warn_once(
            "DrawingRegistry.reset unavailable "
            f"({type(_reset_err).__name__}: {_reset_err})"
        )

    for lib in libraries or []:
        if not isinstance(lib, dict):
            continue
        ns = str(lib.get("namespace") or "")
        name = str(lib.get("name") or "")
        src = str(lib.get("source") or "")
        try:
            ver = int(lib.get("version") or 1)
        except (TypeError, ValueError):
            ver = 1
        if ns and name and src and hasattr(evaluator, "register_library_source"):
            try:
                evaluator.register_library_source(ns, name, ver, src)
            except Exception:
                pass

    script_id = hashlib.sha256(script.encode("utf-8")).hexdigest()[:16]
    run_id = uuid.uuid4().hex[:12]
    t0 = time.perf_counter()
    all_events: list[dict] = []
    all_plots: list[dict] = []

    for bar_index, bar in enumerate(bars):
        # Update series state
        open_series.update(bar.get("open"))
        high_series.update(bar.get("high"))
        low_series.update(bar.get("low"))
        close_series.update(bar.get("close"))
        volume_series.update(bar.get("volume", 0.0))

        # Update per-bar counters
        context["bar_index"] = bar_index
        context["time"] = bar.get("time", 0)

        # Reset plot + event buffers
        evaluator.reset_plots()
        evaluator.reset_events()
        # Track which bar's plot we're capturing (the per-bar buffer
        # gets reset, so we mark each entry with the current bar index).
        _PLOT_BAR_INDEX[0] = bar_index

        try:
            evaluator.evaluate_script(script)
        except Exception as e:
            return {
                "status": "error",
                "plots": [],
                "series": {},
                "events": all_events,
                "error": f"Runtime error at bar {bar_index}: {e!s}",
                "meta": {"ms": (time.perf_counter() - t0) * 1000, "mode": "interpret"},
            }

        # Capture plots emitted on this bar
        for p in evaluator.plot_outputs:
            p["bar_index"] = bar_index
            p["time"] = bar.get("time", 0)
        all_plots.extend(evaluator.plot_outputs)

        # Drain strategy events
        for ev in evaluator._strategy_state.drain_events():
            d = ev.to_dict() if hasattr(ev, "to_dict") else {"type": str(ev)}
            d.setdefault("time", bar.get("time", 0))
            d.setdefault("price", bar.get("close", 0.0))
            d["script_id"] = script_id
            d["run_id"] = run_id
            all_events.append(d)

    # Build plot series aligned with bars
    series: dict[str, list] = {}
    for p in all_plots:
        # Group by name (defaults to "plot")
        kwargs = p.get("kwargs") or {}
        name = str(kwargs.get("title") or kwargs.get("name") or "plot")
        arr = series.setdefault(name, [None] * len(bars))
        bi = p.get("bar_index", -1)
        if 0 <= bi < len(bars):
            v = p.get("value")
            if v is not None and not (isinstance(v, float) and v != v):
                arr[bi] = float(v)

    plots_main = series.get(next(iter(series), ""), [b.get("close") for b in bars])

    # Build an equity curve from events
    equity = 100_000.0
    equity_curve: list[dict] = []
    in_pos = False
    entry_price = 0.0
    for ev in sorted(all_events, key=lambda e: e.get("time", 0)):
        kind = (ev.get("type", "") or ev.get("event", "")).lower()
        price = ev.get("price")
        if price is None:
            continue
        if "entry" in kind:
            in_pos = True
            entry_price = price
        elif "close" in kind or "exit" in kind:
            if in_pos:
                equity *= 1 + (price - entry_price) / max(entry_price, 1e-9)
                in_pos = False
        equity_curve.append({"time": ev["time"], "value": equity})

    # Script declaration → pane routing (indicator default overlay=false)
    decl = getattr(evaluator, "_script_declaration", None)
    overlay = True
    script_name = "plot"
    script_type = "indicator"
    if decl is not None:
        script_type = str(getattr(decl, "script_type", "indicator") or "indicator")
        title = str(getattr(decl, "title", "") or "").strip()
        if title:
            script_name = title
        if hasattr(decl, "overlay"):
            overlay = bool(decl.overlay)
        else:
            kw = getattr(decl, "kwargs", None) or {}
            if "overlay" in kw:
                overlay = bool(kw["overlay"])
            else:
                overlay = script_type == "strategy"

    # Drawing objects + max_*_count caps (AXIS client GC + registry GC in wheel)
    drawings: list = []
    drawing_limits: dict = {}
    try:
        from pynescript.ast.evaluator.builtins.drawing import DrawingRegistry

        bar_times = [b.get("time", 0) for b in bars]
        if not DrawingRegistry.is_empty():
            drawings = DrawingRegistry.export_for_api(bar_times)
        drawing_limits = DrawingRegistry.limits_dict()
    except Exception as _dr_err:
        _warn_once(
            "DrawingRegistry export/limits unavailable, drawings dropped and caps "
            f"unknown ({type(_dr_err).__name__}: {_dr_err})"
        )
        drawings = []
        drawing_limits = {}

    # Synthesize plot_meta from drawings so the AXIS overlay renderer
    # recognises hline / fill / plotshape series and their styling params
    # (kind, linestyle, color, price, …).  Needed in both interpret and
    # compile paths because the series dict has raw data only.
    _plot_meta: dict = {}
    if isinstance(drawings, list):
        for _d in drawings:
            if not isinstance(_d, dict):
                continue
            _kind = str(_d.get("kind") or "").lower()
            _title = str(_d.get("title") or "").strip()
            if not _title:
                continue
            _entry: dict = {}
            if _kind == "hline":
                _entry["kind"] = "hline"
                if _d.get("linestyle"):
                    _entry["linestyle"] = str(_d["linestyle"])
                elif _d.get("style"):
                    _entry["style"] = str(_d["style"])
                if _d.get("color"):
                    _entry["color"] = str(_d["color"])
                if _d.get("price") is not None:
                    _entry["price"] = _d["price"]
            elif _kind == "fill":
                _entry["kind"] = "fill"
                if _d.get("color"):
                    _entry["color"] = str(_d["color"])
                if _d.get("plot1"):
                    _entry["plot1"] = str(_d["plot1"])
                if _d.get("plot2"):
                    _entry["plot2"] = str(_d["plot2"])
            elif _kind in ("plotshape", "plotchar", "plotarrow"):
                _entry["kind"] = _kind
                if _d.get("color"):
                    _entry["color"] = str(_d["color"])
            if _entry:
                _plot_meta[_title] = _entry

    meta: dict = {
        "mode": "interpret",
        "count": len(bars),
        "ms": (time.perf_counter() - t0) * 1000,
        "script_id": script_id,
        "run_id": run_id,
        "overlay": overlay,
        "script_name": script_name,
        "script_type": script_type,
    }
    if drawing_limits:
        meta.update(drawing_limits)
    if _plot_meta:
        meta["plot_meta"] = _plot_meta

    alerts, alert_conditions = _export_alerts(evaluator)
    out = {
        "status": "success",
        "plots": plots_main,
        "series": series,
        "events": all_events,
        "drawings": drawings,
        "alerts": alerts,
        "equity_curve": equity_curve,
        "overlay": overlay,
        "script_name": script_name,
        "script_type": script_type,
        "meta": meta,
    }
    if alert_conditions:
        out["alert_conditions"] = alert_conditions
    return out


def _json_safe_series(values) -> list:
    """NaN/Inf → None so browser JSON.parse never sees bare NaN."""
    if values is None:
        return []
    if hasattr(values, "tolist"):
        values = values.tolist()
    out = []
    for x in values:
        if x is None:
            out.append(None)
            continue
        try:
            if hasattr(x, "item"):
                x = x.item()
        except Exception:
            pass
        if isinstance(x, float) and (x != x or x in (float("inf"), float("-inf"))):
            out.append(None)
        elif isinstance(x, (int, float)):
            out.append(float(x))
        else:
            out.append(x)
    return out


def _drawing_limits_from_script(script: str | None, defaults: dict, hard: dict) -> dict:
    """Parse `max_*_count` declaration caps from Pine source, clamp to the
    language-reference hard caps, and fold in defaults for omitted keys.

    Ignores `//` and `/* */` comments so a cap mentioned inside a comment
    can't be captured. Note: the strip is not string-aware, so a `//` or
    `/* */` sequence inside a Pine string literal is treated as a comment
    start — fail-safe (falls back to the default cap), but keep the parser
    simple rather than lexing strings.
    """
    caps: dict = {**defaults}
    if not script:
        return caps
    text = re.sub(r"/\*.*?\*/", "", script, flags=re.S)
    for key, cap in hard.items():
        found: int | None = None
        for line in text.split("\n"):
            trimmed = line.strip()
            if trimmed.startswith("//"):
                continue
            m = re.search(rf"\b{key}\s*=\s*(\d+)", trimmed.split("//", 1)[0])
            if m:
                found = int(m.group(1))
                break
        if found is not None:
            caps[key] = max(1, min(cap, found))
    return caps


_COMPILER_ALERTS_PATCHED = False

_FREQ_ALIASES = {
    "once_per_bar": "once_per_bar",
    "freq_once_per_bar": "once_per_bar",
    "alert.freq_once_per_bar": "once_per_bar",
    "once_per_bar_close": "once_per_bar_close",
    "freq_once_per_bar_close": "once_per_bar_close",
    "alert.freq_once_per_bar_close": "once_per_bar_close",
    "all": "all",
    "freq_all": "all",
    "alert.freq_all": "all",
}


def _norm_alert_freq(freq) -> str:
    if freq is None:
        return "once_per_bar"
    s = str(freq).strip().lower().replace(" ", "_")
    return _FREQ_ALIASES.get(s, "once_per_bar" if not s else s)


def _truthy_cond(cond) -> bool:
    """Pine na / NaN is false; numpy bools and numbers otherwise."""
    if cond is None:
        return False
    try:
        if cond != cond:  # NaN
            return False
    except Exception:
        pass
    try:
        return bool(cond)
    except Exception:
        return False


def _make_compile_alert_runtime():
    """Module-level recorders injected into compiled execute() globals."""
    alerts: list[dict] = []
    conditions: list[dict] = []
    fire_bars: dict[tuple, int] = {}

    def record_alert(message, freq, bar_idx, time, title=None, source="alert"):
        msg = "" if message is None else str(message)
        title_s = None if title is None else str(title)
        freq_n = _norm_alert_freq(freq)
        src = "alertcondition" if str(source) == "alertcondition" else "alert"
        if freq_n != "all":
            key = (src, title_s or "", msg, freq_n)
            last = fire_bars.get(key)
            try:
                bi = int(bar_idx) if bar_idx is not None else None
            except (TypeError, ValueError):
                bi = None
            if bi is not None and last is not None and last == bi:
                return
            if bi is not None:
                fire_bars[key] = bi
        rec: dict = {
            "message": msg or (title_s or "Alert"),
            "freq": freq_n,
            "source": src,
        }
        try:
            if bar_idx is not None:
                rec["bar_index"] = int(bar_idx)
        except (TypeError, ValueError):
            pass
        try:
            if time is not None and time == time:
                rec["time"] = int(time)
        except (TypeError, ValueError):
            pass
        if title_s:
            rec["title"] = title_s
        alerts.append(rec)

    def record_alertcondition(cond, title, message, bar_idx, time):
        ok = _truthy_cond(cond)
        title_s = "Alert" if title is None else str(title)
        msg = "Alert" if message is None else str(message)
        rec: dict = {
            "condition": ok,
            "title": title_s,
            "message": msg,
        }
        try:
            if bar_idx is not None:
                rec["bar_index"] = int(bar_idx)
        except (TypeError, ValueError):
            pass
        try:
            if time is not None and time == time:
                rec["time"] = int(time)
        except (TypeError, ValueError):
            pass
        conditions.append(rec)
        if ok:
            record_alert(msg, "once_per_bar", bar_idx, time, title_s, "alertcondition")

    return alerts, conditions, record_alert, record_alertcondition


def _visit_call_arg_expr(visitor, arg) -> str:
    val = arg.value if hasattr(arg, "value") else arg
    expr = visitor.visit(val)
    return expr if isinstance(expr, str) else ""


def _emit_compile_alert_call(func_id: str, arg_exprs: list[str]) -> str:
    """Python snippet recorded into the compiled bar loop."""
    time_expr = "time_arr[__bar_idx]"
    if func_id == "alert":
        if not arg_exprs:
            return ""
        message = arg_exprs[0]
        freq = arg_exprs[1] if len(arg_exprs) > 1 else repr("once_per_bar")
        return (
            f"__record_alert({message}, {freq}, __bar_idx, {time_expr}, None, 'alert')"
        )
    # alertcondition(condition, title, message)
    if not arg_exprs:
        return ""
    cond = arg_exprs[0]
    title = arg_exprs[1] if len(arg_exprs) > 1 else repr("Alert")
    message = arg_exprs[2] if len(arg_exprs) > 2 else repr("Alert")
    return (
        f"__record_alertcondition({cond}, {title}, {message}, __bar_idx, {time_expr})"
    )


def _patch_compiler_alerts() -> None:
    """Make compile emit `alert()` / `alertcondition()` instead of no-ops.

    The wheel's CompilerVisitor.visit_Call returns ``\"\"`` for those builtins
    because Numba nopython cannot append Python dicts. AXIS forces object mode
    and records firings via ``__record_alert*`` injected into execute globals.
    """
    global _COMPILER_ALERTS_PATCHED
    if _COMPILER_ALERTS_PATCHED:
        return
    from pynescript.compiler.compiler import CompilerVisitor

    orig = CompilerVisitor.visit_Call

    def visit_Call(self, node):  # noqa: N802 — match visitor API
        func = getattr(node, "func", None)
        if func is not None and type(func).__name__ == "Specialize":
            func = getattr(func, "value", func)
        if func is not None and type(func).__name__ == "Name":
            fid = getattr(func, "id", None)
            if fid in ("alert", "alertcondition"):
                self.object_mode = True
                exprs: list[str] = []
                for arg in getattr(node, "args", None) or []:
                    expr = _visit_call_arg_expr(self, arg)
                    if expr:
                        exprs.append(expr)
                return _emit_compile_alert_call(fid, exprs)
        return orig(self, node)

    CompilerVisitor.visit_Call = visit_Call
    _COMPILER_ALERTS_PATCHED = True


def _run_compiled(script: str, bars: list[dict]) -> dict:
    """Numba/object compile path from the vendored pynescript wheel."""
    import numpy as np
    from pynescript.compiler.engine import compile_script

    _patch_compiler_alerts()

    if not bars:
        return {
            "status": "success",
            "plots": [],
            "series": {},
            "events": [],
            "alerts": [],
            "meta": {"mode": "compile", "count": 0},
        }

    t0 = time.perf_counter()
    compiled = compile_script(script)
    alert_acc, cond_acc, record_alert, record_cond = _make_compile_alert_runtime()
    g = getattr(getattr(compiled, "execute", None), "__globals__", None)
    if isinstance(g, dict):
        g["__record_alert"] = record_alert
        g["__record_alertcondition"] = record_cond
    opens = [float(b.get("open", 0.0) or 0.0) for b in bars]
    highs = [float(b.get("high", 0.0) or 0.0) for b in bars]
    lows = [float(b.get("low", 0.0) or 0.0) for b in bars]
    closes = [float(b.get("close", 0.0) or 0.0) for b in bars]
    volumes = [float(b.get("volume", 1.0) or 1.0) for b in bars]
    times = [float(b.get("time", 0.0) or 0.0) for b in bars]
    series_map = compiled.run(opens, highs, lows, closes, volumes, times)

    drawings = []
    events = []
    packed_alerts = []
    if isinstance(series_map, dict):
        drawings = series_map.pop("__drawings", []) or []
        events = series_map.pop("__events", []) or []
        packed_alerts = series_map.pop("__alerts", []) or []
        for k in ("__position_size", "__netprofit", "__equity"):
            series_map.pop(k, None)

    # Compile-path GC: trim append-only __drawings by declaration caps (defaults 50)
    _default_limits = {
        "max_lines_count": 50,
        "max_labels_count": 50,
        "max_boxes_count": 50,
        "max_polylines_count": 50,
    }
    _hard = {
        "max_lines_count": 500,
        "max_labels_count": 500,
        "max_boxes_count": 500,
        "max_polylines_count": 100,
    }
    drawing_limits = _drawing_limits_from_script(script, _default_limits, _hard)
    try:
        from pynescript.ast.evaluator.builtins.drawing import DrawingRegistry

        if isinstance(drawings, list) and drawings:
            drawings = DrawingRegistry.gc_exported_drawings(drawings, drawing_limits)
    except Exception as _gc_err:
        # Don't fail closed silently: meta advertises the caps, so note the
        # GC being skipped when the wheel API changes/moves.
        _warn_once(
            "drawing GC unavailable, __drawings left untrimmed while caps are "
            f"still advertised ({type(_gc_err).__name__}: {_gc_err})"
        )

    json_series = {
        str(k): _json_safe_series(v)
        for k, v in (series_map or {}).items()
        if not str(k).startswith("__")
    }
    plots_main = next(iter(json_series.values()), []) if json_series else []
    script_id = hashlib.sha256(script.encode("utf-8")).hexdigest()[:16]
    run_id = uuid.uuid4().hex[:12]

    # Synthesize plot_meta from __drawings so the AXIS overlay renderer
    # recognises hline / fill / plotshape series and their styling params
    # (kind, linestyle, color, price, …).  The compiler does not emit
    # plot_meta directly — the series dict has raw data only.
    _plot_meta: dict = {}
    if isinstance(drawings, list):
        for _d in drawings:
            if not isinstance(_d, dict):
                continue
            _kind = str(_d.get("kind") or "").lower()
            _title = str(_d.get("title") or "").strip()
            if not _title:
                continue
            _entry: dict = {}
            if _kind == "hline":
                _entry["kind"] = "hline"
                if _d.get("linestyle"):
                    _entry["linestyle"] = str(_d["linestyle"])
                elif _d.get("style"):
                    _entry["style"] = str(_d["style"])
                if _d.get("color"):
                    _entry["color"] = str(_d["color"])
                if _d.get("price") is not None:
                    _entry["price"] = _d["price"]
            elif _kind == "fill":
                _entry["kind"] = "fill"
                if _d.get("color"):
                    _entry["color"] = str(_d["color"])
                if _d.get("plot1"):
                    _entry["plot1"] = str(_d["plot1"])
                if _d.get("plot2"):
                    _entry["plot2"] = str(_d["plot2"])
            elif _kind in ("plotshape", "plotchar", "plotarrow"):
                _entry["kind"] = _kind
                if _d.get("color"):
                    _entry["color"] = str(_d["color"])
            if _entry:
                _plot_meta[_title] = _entry

    _meta: dict = {
        "mode": "compile",
        **drawing_limits,
        "object_mode": bool(getattr(compiled, "object_mode", False)),
        "count": len(bars),
        "ms": (time.perf_counter() - t0) * 1000,
        "script_id": script_id,
        "run_id": run_id,
        "overlay": True,
        "script_name": "plot",
    }
    if _plot_meta:
        _meta["plot_meta"] = _plot_meta
    alerts_out = list(alert_acc)
    if isinstance(packed_alerts, list) and packed_alerts:
        alerts_out.extend(a for a in packed_alerts if isinstance(a, dict))
    out = {
        "status": "success",
        "plots": plots_main,
        "series": json_series,
        "events": events if isinstance(events, list) else [],
        "drawings": drawings if isinstance(drawings, list) else [],
        "alerts": alerts_out,
        "overlay": True,
        "script_name": "plot",
        "meta": _meta,
    }
    if cond_acc:
        out["alert_conditions"] = list(cond_acc)
    return out


def run_script(
    script: str,
    bars: list[dict],
    mode: str = "interpret",
    libraries: list | None = None,
) -> str:
    """Top-level entry. Always returns a JSON string for the JS side.

    ``mode`` is interpret|compile|auto (same semantics as the Pro API).
    ``libraries`` is an optional list of ``{namespace,name,version,source}``.
    """
    mode_norm = (mode or "interpret").strip().lower()
    if mode_norm not in ("interpret", "compile", "auto"):
        mode_norm = "interpret"

    try:
        if mode_norm in ("compile", "auto"):
            try:
                out = _run_compiled(script, bars)
                return json.dumps(out, allow_nan=False, default=str)
            except Exception as compile_err:
                if mode_norm == "compile":
                    return json.dumps(
                        {
                            "status": "error",
                            "plots": [],
                            "series": {},
                            "events": [],
                            "error": (
                                f"Compile mode unavailable in Pyodide: {compile_err}. "
                                "Numeric compile needs Numba (server engine); "
                                "object-mode needs NumPy. Use interpret or server."
                            ),
                            "meta": {"mode": "compile"},
                        }
                    )
                # auto → interpret fallback
                out = _run_interpret(script, bars, libraries)
                if isinstance(out, dict):
                    out.setdefault("meta", {})
                    out["meta"]["auto_backend"] = "interpret"
                    out["meta"]["compile_fallback_reason"] = str(compile_err)
                return json.dumps(out, allow_nan=False, default=str)

        out = _run_interpret(script, bars, libraries)
        return json.dumps(out, allow_nan=False, default=str)
    except Exception as e:
        return json.dumps(
            {
                "status": "error",
                "plots": [],
                "series": {},
                "events": [],
                "error": f"{type(e).__name__}: {e}",
                "meta": {"mode": mode_norm},
            }
        )
