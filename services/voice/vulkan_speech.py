"""Optional Vulkan acceleration for the waveform decoder in the two Nigerian VITS voices."""
import os
from pathlib import Path
import subprocess
import tempfile


def hardware_gpu():
    try:
        import ncnn
    except ImportError:
        return None
    # ncnn also enumerates software Vulkan devices such as Mesa llvmpipe.
    for index in range(ncnn.get_gpu_count()):
        if ncnn.get_gpu_info(index).type() in (0, 1):
            return index
    return None


class VulkanDecoder:
    def __init__(self, directory, gpu):
        import ncnn

        self.net = ncnn.Net()
        self.net.opt.use_vulkan_compute = True
        # Half-precision storage preserves the weights. Accumulating in FP32
        # avoids saturated output on Intel Gen9 graphics.
        self.net.opt.use_fp16_arithmetic = False
        self.net.set_vulkan_device(gpu)
        if self.net.load_param(str(directory / "decoder.param")) or self.net.load_model(str(directory / "decoder.bin")):
            raise RuntimeError("Could not load the Vulkan speech decoder")

    def __call__(self, spectrogram):
        import ncnn
        import numpy as np
        import torch

        tensor = spectrogram.detach().cpu().contiguous().numpy()
        with self.net.create_extractor() as extractor:
            # ncnn expects channels, height, width for a batch of one.
            if extractor.input("in0", ncnn.Mat(tensor.reshape(tensor.shape[1], 1, -1)).clone()):
                raise RuntimeError("Could not submit the voice spectrogram")
            status, result = extractor.extract("out0")
            if status:
                raise RuntimeError("Vulkan speech synthesis failed")
            return torch.from_numpy(np.array(result, copy=True))


def export(directory):
    import pnnx
    import torch
    from torch import nn
    from transformers import VitsModel

    # Use the image convolution kernels available on mobile and integrated
    # GPUs. A height of one preserves each temporal convolution exactly.
    destination = directory / "vulkan-decoder-v1"
    if (destination / "decoder.param").is_file() and (destination / "decoder.bin").is_file():
        return
    with tempfile.TemporaryDirectory(dir=directory) as work, torch.inference_mode():
        work = Path(work)
        decoder = VitsModel.from_pretrained(directory, local_files_only=True, use_safetensors=True).eval().decoder
        for name, layer in list(decoder.named_modules()):
            if not isinstance(layer, (nn.Conv1d, nn.ConvTranspose1d)):
                continue
            conv = nn.ConvTranspose2d if isinstance(layer, nn.ConvTranspose1d) else nn.Conv2d
            planar = conv(layer.in_channels, layer.out_channels, (1, layer.kernel_size[0]),
                          stride=(1, layer.stride[0]), padding=(0, layer.padding[0]),
                          dilation=(1, layer.dilation[0]), groups=layer.groups, bias=layer.bias is not None)
            planar.weight.copy_(layer.weight.unsqueeze(2))
            if layer.bias is not None:
                planar.bias.copy_(layer.bias)
            parent, _, child = name.rpartition(".")
            setattr(decoder.get_submodule(parent), child, planar)
        torch.set_num_threads(min(2, torch.get_num_threads()))
        sample = torch.zeros(1, decoder.config.flow_size, 1, 2)
        torch.jit.trace(decoder.eval(), sample, check_trace=False).save(str(work / "speech.pt"))
        subprocess.run([pnnx.EXEC_PATH, "speech.pt", "inputshape=[1,192,1,2]", "inputshape2=[1,192,1,3]",
                        "fp16=1", "ncnnparam=decoder.param", "ncnnbin=decoder.bin"], cwd=work, check=True)
        # Publish the pair together, including when two installers overlap.
        ready = work / "ready"
        ready.mkdir()
        for filename in ("decoder.bin", "decoder.param"):
            (work / filename).rename(ready / filename)
        try:
            os.rename(ready, destination)
        except OSError:
            if not all((destination / file).is_file() for file in ("decoder.param", "decoder.bin")):
                raise


if __name__ == "__main__":
    from nigerian_speech import voice_root
    for gender in ("male", "female"):
        export(voice_root() / ("naija-" + gender))
