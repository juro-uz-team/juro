"""Build the exact sparse scoring kernel into an explicit deployment output path."""
import argparse
import os
import pathlib
import subprocess


def build(output):
    output = pathlib.Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([os.environ.get('CC', 'gcc' if os.name == 'nt' else 'cc'),
                    '-O3', '-std=c11', '-ffp-contract=off', '-fPIC', '-shared',
                    str(pathlib.Path(__file__).with_name('sparse_kernel.c')),
                    '-o', str(output), '-lm'], check=True)
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output')
    build(parser.parse_args().output)
