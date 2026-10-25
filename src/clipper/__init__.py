import os

# The Cinematic solve's dense fallback runs typical pairs 5 to 7x faster on one OpenBLAS thread (a 39 s
# pair: 0.15 s against about 1 s). Set here, before any clipper module loads numpy.
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
