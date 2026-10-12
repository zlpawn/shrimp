import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).parents[2] / "lib" / "skills" / "leo-fooocus-imagine" / "scripts" / "fooocus_gradio_client.py"
SPEC = importlib.util.spec_from_file_location("fooocus_gradio_client", MODULE_PATH)
CLIENT = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(CLIENT)


def component(component_id, component_type, label="", value=None, choices=None, elem_id=None):
    props = {"label": label, "value": value}
    if choices is not None:
        props["choices"] = choices
    if elem_id is not None:
        props["elem_id"] = elem_id
    return {"id": component_id, "type": component_type, "props": props}


class FooocusAdvancedAdapterTests(unittest.TestCase):
    def test_discovers_lora_control_describe_and_enhance_semantically(self):
        config = {
            "components": [
                component(1, "state"),
                component(10, "textbox", elem_id="positive_prompt"),
                component(11, "textbox", "Negative Prompt"),
                component(12, "dropdown", "Base Model"),
                component(20, "checkbox", "Enable", False),
                component(21, "dropdown", "LoRA 1", "None", ["None", "detail.safetensors"]),
                component(22, "slider", "Weight", 1.0),
                component(30, "image", "Image"),
                component(31, "slider", "Stop At", 0.5),
                component(32, "slider", "Weight", 0.6),
                component(33, "radio", "Type", "ImagePrompt", [["ImagePrompt", "ImagePrompt"], ["PyraCanny", "PyraCanny"], ["CPDS", "CPDS"], ["FaceSwap", "FaceSwap"]]),
                component(34, "textbox", "Detection prompt", "ordinary inpaint prompt"),
                component(35, "dropdown", "Mask generation model", "isnet-general-use"),
                component(41, "image", "Use with Enhance, skips image generation"),
                component(40, "checkbox", "Enhance", False),
                component(42, "checkbox", "Enable", False),
                component(43, "textbox", "Detection prompt", ""),
                component(44, "textbox", "Enhancement positive prompt", "", elem_id="enhance_prompt"),
                component(45, "textbox", "Enhancement negative prompt", "", elem_id="enhance_negative_prompt"),
                component(50, "checkboxgroup", "Content Type", ["Photograph"]),
                component(51, "image", "Image"),
                component(52, "checkbox", "Apply Styles", True),
                component(53, "checkboxgroup", "Selected Styles", []),
                component(60, "gallery", "Gallery"),
                component(61, "image", "Preview"),
            ],
            "dependencies": [
                {"trigger": "click", "inputs": [50, 51, 52], "outputs": [10, 53]},
                {"inputs": [1], "outputs": [60, 61]},
                {"inputs": [10, 11, 12, 20, 21, 22, 30, 31, 32, 33, 34, 35, 41, 40, 42, 43, 44, 45], "outputs": [1]},
            ],
        }
        plan = CLIENT.discover_plan(config)
        self.assertEqual(plan["lora_slots"], [{"enabled": 20, "model": 21, "weight": 22}])
        self.assertEqual(plan["control_slots"], [{"image": 30, "stop_at": 31, "weight": 32, "type": 33}])
        self.assertEqual(plan["enhance"]["input"], 41)
        self.assertEqual(plan["enhance"]["master_enabled"], 40)
        self.assertEqual(plan["enhance"]["detection_prompt"], 43)
        describe = CLIENT.discover_describe_plan(config)
        self.assertEqual(describe["fn"], 0)
        self.assertEqual(describe["methods"], 50)
        self.assertEqual(describe["image"], 51)
        self.assertEqual(describe["apply_styles"], 52)

    def test_parses_multiple_lora_and_control_specs_without_breaking_windows_paths(self):
        self.assertEqual(
            CLIENT.parse_lora_specs(["detail.safetensors|0.7", "lighting.safetensors"]),
            [("detail.safetensors", 0.7), ("lighting.safetensors", 1.0)],
        )
        self.assertEqual(
            CLIENT.parse_control_specs([r"C:\images\pose.png|PyraCanny|0.65|0.8"]),
            [(str(pathlib.Path(r"C:\images\pose.png").resolve()), "PyraCanny", 0.65, 0.8)],
        )

    def test_control_specs_enable_the_input_image_channel(self):
        plan = {
            "components": {
                5: component(5, "radio", "Type", "ImagePrompt", [["ImagePrompt", "ImagePrompt"], ["PyraCanny", "PyraCanny"], ["CPDS", "CPDS"], ["FaceSwap", "FaceSwap"]]),
            },
            "control_slots": [{"image": 2, "stop_at": 3, "weight": 4, "type": 5}],
            "semantics": {"input_enabled": 1},
        }
        overrides = {}
        image = pathlib.Path(__file__).resolve()
        CLIENT.apply_controls(plan, overrides, [f"{image}|PyraCanny|0.65|0.8"])
        self.assertIs(overrides[1], True)


if __name__ == "__main__":
    unittest.main()
