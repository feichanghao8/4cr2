#include "Patcher/Patcher.hpp"
#include "PatchesDeviceInfo.hpp"
#include "PatchesWebsiteLibMin.hpp"

#include <unordered_map>
#include <vector>
#include <fstream>
#include <iostream>
#include <filesystem>

static std::string ReadFileUTF8(std::string_view path)
{
	// I don't know how to do this properly off the top of my head.
	std::ifstream stream {path.data(), std::ios::binary};
	if (!stream) {
		return {};
	}

	std::vector<uint8_t> binary {std::istreambuf_iterator<char> {stream},
	                             std::istreambuf_iterator<char> {}};

	// Add that pesky null terminator.
	binary.emplace_back(0);

	return reinterpret_cast<const char*>(binary.data());
}
static bool WriteFileUTF8(std::string_view path, std::string_view contents)
{
	std::ofstream stream {path.data(), std::ios_base::out | std::ios_base::binary};
	return !!stream.write(contents.data(), contents.size());
}


int main(int argc, const char *const argv[])
{
	// This is what an 11 hour flight without WIFI causes you to do.
	// Go insane.

	const auto unpacked = std::filesystem::path {argv[1]};
	if (!std::filesystem::exists(unpacked))
	{
		printf("Unpacked game directory not found\n");
		return -1;
	}

	std::unordered_map<std::string, std::span<const patcher::Descriptor>> patches {};
	patches[(unpacked / "controller" / "deviceInfo.js").string()] = kPatchesDeviceInfo;
	patches[(unpacked / "involved" / "website-lib" / "website-lib.min.js").string()] = kPatchesWebsiteLibMin;

	for (const auto &[file, descs] : patches)
	{
		std::string contents = ReadFileUTF8(file);
		if (contents.empty())
		{
			printf("Unable to read contents of file:(%s)\n", file.data());
			return -1;
		}

		if (auto token = patcher::Apply(contents, descs); !token.empty())
		{
			printf("Unable to apply all patches to file:(%s), token:(%s)\n",
				file.data(), token.data());
			return -1;
		}

		WriteFileUTF8(file, contents);
		printf("Patched file:(%s)\n", file.data());
	}

	return 0;
}
